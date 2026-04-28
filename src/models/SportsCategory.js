import mongoose from 'mongoose';

const sportsCategorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  displayName: { type: String, default: '' },
  slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
  icon: { type: String, default: '' },
  image: { type: String, default: '' },
  logo: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },
}, { timestamps: true });

export default mongoose.model('SportsCategory', sportsCategorySchema);
