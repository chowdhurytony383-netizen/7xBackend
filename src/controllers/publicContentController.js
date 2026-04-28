import PublicContent from '../models/PublicContent.js';
import { asyncHandler } from '../utils/asyncHandler.js';

function sectionFromReq(req) {
  return req.params[0] || req.path.replace(/^\//, '');
}

export const getContent = asyncHandler(async (req, res) => {
  const section = sectionFromReq(req);
  const items = await PublicContent.find({ section, isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).limit(100);
  res.json({ success: true, data: items, items, records: items });
});
