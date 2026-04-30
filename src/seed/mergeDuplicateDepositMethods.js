import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import Agent from '../models/Agent.js';
import DepositMethod from '../models/DepositMethod.js';
import { ensureDefaultDepositMethods } from '../controllers/depositMethodController.js';
import { groupDepositMethodsByTitle, normalizePaymentMethodKeyList } from '../utils/paymentMethodCanonical.js';

function methodToPlain(method) {
  return method?.toObject ? method.toObject() : (method || {});
}

function paymentToPlain(method) {
  return method?.toObject ? method.toObject() : (method || {});
}

function chooseBetterPayment(primaryPayment, duplicatePayment) {
  const primary = paymentToPlain(primaryPayment);
  const duplicate = paymentToPlain(duplicatePayment);

  if (!primary.number && duplicate.number) return duplicate;
  if (primary.isActive === false && duplicate.isActive !== false && duplicate.number) return duplicate;

  return primary;
}

async function mergeDuplicateDepositMethods() {
  await connectDB();
  await ensureDefaultDepositMethods();

  const methods = await DepositMethod.find().sort({ displayOrder: 1, createdAt: 1 });
  const groups = groupDepositMethodsByTitle(methods).filter((group) => group.methods.length > 1);

  if (!groups.length) {
    console.log('No duplicate deposit methods found.');
    await mongoose.disconnect();
    return;
  }

  let disabledMethodCount = 0;
  let updatedAgentCount = 0;

  for (const group of groups) {
    const primary = methodToPlain(group.primary);
    const duplicateKeys = group.methods
      .slice(1)
      .map((method) => methodToPlain(method).key)
      .filter(Boolean);

    console.log(`Merging duplicates for "${primary.title}" -> primary key "${primary.key}"; duplicates: ${duplicateKeys.join(', ')}`);

    const agents = await Agent.find({
      $or: [
        { 'paymentMethods.key': { $in: duplicateKeys } },
        { allowedPaymentMethodKeys: { $in: duplicateKeys } },
      ],
    });

    for (const agent of agents) {
      const paymentByKey = new Map((agent.paymentMethods || []).map((method) => {
        const plain = paymentToPlain(method);
        return [plain.key, plain];
      }));

      let primaryPayment = paymentByKey.get(primary.key) || {
        key: primary.key,
        title: primary.title,
        number: '',
        image: '',
        note: '',
        isActive: true,
        updatedAt: undefined,
      };

      for (const duplicateKey of duplicateKeys) {
        const duplicatePayment = paymentByKey.get(duplicateKey);
        if (!duplicatePayment) continue;
        primaryPayment = {
          ...primaryPayment,
          ...chooseBetterPayment(primaryPayment, duplicatePayment),
          key: primary.key,
          title: primary.title,
          image: '',
        };
      }

      const nextPaymentMethods = [];
      const seen = new Set();

      for (const method of agent.paymentMethods || []) {
        const plain = paymentToPlain(method);
        if (duplicateKeys.includes(plain.key)) continue;
        if (plain.key === primary.key) continue;
        if (seen.has(plain.key)) continue;
        seen.add(plain.key);
        nextPaymentMethods.push(plain);
      }

      nextPaymentMethods.push(primaryPayment);
      agent.paymentMethods = nextPaymentMethods;

      if (Array.isArray(agent.allowedPaymentMethodKeys)) {
        const allowed = normalizePaymentMethodKeyList(agent.allowedPaymentMethodKeys)
          .map((key) => (duplicateKeys.includes(key) ? primary.key : key));
        agent.allowedPaymentMethodKeys = [...new Set(allowed)];
      }

      await agent.save();
      updatedAgentCount += 1;
    }

    for (const duplicateKey of duplicateKeys) {
      const duplicateMethod = await DepositMethod.findOne({ key: duplicateKey });
      if (!duplicateMethod) continue;
      duplicateMethod.isActive = false;
      duplicateMethod.displayOrder = Number(duplicateMethod.displayOrder || primary.displayOrder || 100) + 10000;
      await duplicateMethod.save();
      disabledMethodCount += 1;
    }
  }

  console.log('Duplicate deposit method merge complete.');
  console.log('Disabled duplicate methods:', disabledMethodCount);
  console.log('Updated agent records:', updatedAgentCount);

  await mongoose.disconnect();
}

mergeDuplicateDepositMethods().catch(async (error) => {
  console.error('Merge failed:', error);
  await mongoose.disconnect();
  process.exit(1);
});
