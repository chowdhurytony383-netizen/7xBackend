import SportsCategory from '../models/SportsCategory.js';
import SportsMatch from '../models/SportsMatch.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const categories = asyncHandler(async (_req, res) => {
  const items = await SportsCategory.find({ isActive: true }).sort({ sortOrder: 1, name: 1 });
  res.json({ success: true, data: items, categories: items, sports: items });
});

export const liveMatches = asyncHandler(async (_req, res) => {
  const matches = await SportsMatch.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).limit(50);
  res.json({ success: true, data: matches, matches, liveMatches: matches, events: matches });
});

export const matchOfTheDay = asyncHandler(async (_req, res) => {
  const match = await SportsMatch.findOne({ isActive: true, isMatchOfTheDay: true }).sort({ sortOrder: 1, createdAt: -1 })
    || await SportsMatch.findOne({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 });
  res.json({ success: true, data: match, match, matchOfTheDay: match, event: match });
});
