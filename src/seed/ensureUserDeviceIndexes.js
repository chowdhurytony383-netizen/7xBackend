import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import UserDevice from '../models/UserDevice.js';

await connectDB();
await UserDevice.syncIndexes();
console.log('User device indexes synced');
await mongoose.disconnect();
