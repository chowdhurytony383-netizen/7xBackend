import mongoose from 'mongoose';

const gameSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    unique: true,
    index: true,
  },

  slug: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    unique: true,
    index: true,
  },

  displayName: {
    type: String,
    required: true,
    trim: true,
  },

  gameCode: {
    type: String,
    trim: true,
    lowercase: true,
    index: true,
  },

  description: {
    type: String,
    default: '',
  },

  image: {
    type: String,
    default: '',
  },

  category: {
    type: String,
    default: 'casino',
  },

  type: {
    type: String,
    enum: ['internal', 'source', 'provider'],
    default: 'internal',
  },

  distribution: {
    type: String,
    enum: ['internal', 'source', 'provider'],
    default: 'internal',
  },

  route: {
    type: String,
    default: '',
  },

  assetPath: {
    type: String,
    default: '',
  },

  provider: {
    type: String,
    default: '7XBET',
  },

  isActive: {
    type: Boolean,
    default: true,
    index: true,
  },

  sortOrder: {
    type: Number,
    default: 0,
  },

  config: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, { timestamps: true });

gameSchema.pre('validate', function setDefaults(next) {
  if (!this.slug && this.name) {
    this.slug = String(this.name)
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/_/g, '-');
  }

  if (!this.gameCode && this.name) {
    this.gameCode = String(this.name)
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '')
      .replace(/-/g, '')
      .replace(/_/g, '');
  }

  if (!this.route) {
    if (this.distribution === 'source' || this.type === 'source') {
      this.route = `/source-games/${this.gameCode || this.name}`;
    } else if (this.name === 'dice') {
      this.route = '/games/dice';
    } else if (this.name === 'mines') {
      this.route = '/games/mines';
    }
  }

  next();
});

export default mongoose.model('Game', gameSchema);