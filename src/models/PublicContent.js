import mongoose from 'mongoose';

const publicContentSchema = new mongoose.Schema({
  section: { type: String, required: true, index: true },
  title: { type: String, required: true },
  displayName: { type: String, default: '' },
  name: { type: String, default: '' },
  description: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  image: { type: String, default: '' },
  banner: { type: String, default: '' },
  thumbnail: { type: String, default: '' },
  icon: { type: String, default: '' },
  type: { type: String, default: '' },
  status: { type: String, default: 'active' },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  isActive: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },
}, { timestamps: true });

export default mongoose.model('PublicContent', publicContentSchema);
