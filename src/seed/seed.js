import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { env } from '../config/env.js';
import User from '../models/User.js';
import Game from '../models/Game.js';
import SportsCategory from '../models/SportsCategory.js';
import SportsMatch from '../models/SportsMatch.js';
import PublicContent from '../models/PublicContent.js';
import { createUniqueUserId } from '../utils/identity.js';

const games = [
  {
    name: 'dice',
    slug: 'dice',
    gameCode: 'dice',
    displayName: 'Dice',
    description: 'Roll the dice and win instantly.',
    image: '/images/dice-game/logo.avif',
    category: 'casino',
    type: 'internal',
    distribution: 'internal',
    route: '/games/dice',
    provider: '7XBET',
    isActive: true,
    sortOrder: 1,
  },
  {
    name: 'mines',
    slug: 'mines',
    gameCode: 'mines',
    displayName: 'Mines',
    description: 'Reveal safe tiles and cash out before hitting a mine.',
    image: '/images/mines-game/poster.avif',
    category: 'casino',
    type: 'internal',
    distribution: 'internal',
    route: '/games/mines',
    provider: '7XBET',
    isActive: true,
    sortOrder: 2,
  },
  {
    name: 'fortunetiger',
    slug: 'fortune-tiger',
    gameCode: 'fortunetiger',
    displayName: 'Fortune Tiger',
    description: 'Original source slot game.',
    image: '/originals/fortunetiger/icons/icon-512.png',
    category: 'casino',
    type: 'source',
    distribution: 'source',
    route: '/source-games/fortunetiger',
    assetPath: '/originals/fortunetiger/index.html',
    provider: 'ViperPro',
    isActive: true,
    sortOrder: 3,
  },
  {
    name: 'bikiniparadise',
    slug: 'bikini-paradise',
    gameCode: 'bikiniparadise',
    displayName: 'Bikini Paradise',
    description: 'Original source slot game with wallet-backed 25-line spin flow.',
    image: '/originals/bikiniparadise/icons/icon-512.png',
    category: 'casino',
    type: 'source',
    distribution: 'source',
    route: '/source-games/bikiniparadise',
    assetPath: '/originals/bikiniparadise/index.html',
    provider: 'ViperPro',
    isActive: true,
    sortOrder: 4,
  },
  {
    name: 'crash',
    slug: 'crash',
    gameCode: 'crash',
    displayName: 'Crash',
    description: 'Crash game content is controlled from backend/admin.',
    image: '',
    category: 'casino',
    type: 'provider',
    distribution: 'provider',
    route: '/crash',
    provider: '7XBET',
    isActive: false,
    sortOrder: 5,
  },
];

const sportsCategories = [
  'Cricket',
  'Football',
  'Volleyball',
  'Basketball',
  'Tennis',
  'Table Tennis',
  'American Football',
  'Baseball',
  'Beach Volleyball',
  'Bowling',
  'Esports',
  'Greyhound',
].map((name, index) => ({
  name,
  displayName: name,
  slug: name.toLowerCase().replace(/\s+/g, '-'),
  sortOrder: index + 1,
  isActive: true,
}));

const sportsMatches = [
  {
    sport: 'football',
    country: 'Spain',
    league: 'La Liga',
    tournament: 'Football. Spain. La Liga',
    homeTeam: { name: 'Villarreal' },
    awayTeam: { name: 'Celta' },
    score: { home: 2, away: 0 },
    status: 'Live',
    markets: [
      { label: '1', value: 1.07 },
      { label: 'X', value: 10 },
      { label: '2', value: 26 },
      { label: '1X', value: 1.006 },
      { label: '12th', value: 1.065 },
      { label: '2X', value: 7.32 },
    ],
    moreMarkets: 434,
    startTime: '27/04 01:00',
    isMatchOfTheDay: true,
    sortOrder: 1,
  },
  {
    sport: 'football',
    country: 'France',
    league: 'Ligue 1',
    tournament: 'Football. France. Ligue 1',
    homeTeam: { name: 'Olympique de Marseille' },
    awayTeam: { name: 'Nice' },
    score: { home: 0, away: 0 },
    status: 'Live',
    markets: [
      { label: '1', value: 1.83 },
      { label: 'X', value: 2.67 },
      { label: '2', value: 7.5 },
      { label: '1X', value: 1.1 },
      { label: '12th', value: 1.485 },
      { label: '2X', value: 1.975 },
    ],
    moreMarkets: 419,
    startTime: '27/04 02:00',
    sortOrder: 2,
  },
  {
    sport: 'football',
    country: 'Italy',
    league: 'Serie A',
    tournament: 'Football. Italy. Serie A',
    homeTeam: { name: 'Milan' },
    awayTeam: { name: 'Juventus' },
    score: { home: 0, away: 0 },
    status: 'Live',
    markets: [
      { label: '1', value: 3.57 },
      { label: 'X', value: 2.248 },
      { label: '2', value: 3.27 },
      { label: '1X', value: 1.36 },
      { label: '12th', value: 1.68 },
      { label: '2X', value: 1.315 },
    ],
    moreMarkets: 375,
    startTime: '27/04 03:00',
    sortOrder: 3,
  },
];

const content = [
  ['bet-on-games', 'BetOnGames', 'Backend-controlled BetOnGames content.'],
  ['bets/slip', 'Bet slip', 'Backend-controlled bet slip content.'],
  ['bonuses', 'Bonuses', 'Bonus campaigns are controlled by admin.'],
  ['bonuses/welcome', 'Welcome bonus', 'Welcome bonus configuration.'],
  ['bonuses/cashback', 'Cashback', 'Cashback offers.'],
  ['bonuses/vip', 'VIP rewards', 'VIP reward tiers.'],
  ['games/crash', 'Crash', 'Crash game content.'],
  ['support', 'Customer Support', 'Support channels and contact information.'],
  ['esports/events', 'Esports', 'Esports events list.'],
  ['casino/live', 'Live Casino', 'Live casino providers.'],
  ['casino/slots', 'Slots', 'Slot games list.'],
  ['other', 'Other', 'Other information.'],
  ['other/promotions', 'Promotions', 'Promotional content.'],
  ['other/faq', 'FAQ', 'Frequently asked questions.'],
  ['other/rules', 'Rules', 'Platform rules.'],
  ['tournaments', 'Tournaments', 'Tournament information.'],
].map(([section, title, description], index) => ({
  section,
  title,
  displayName: title,
  name: title,
  description,
  sortOrder: index + 1,
  isActive: true,
}));

async function upsertMany(Model, docs, key = 'slug') {
  for (const doc of docs) {
    await Model.findOneAndUpdate(
      { [key]: doc[key] },
      doc,
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );
  }
}

async function seed() {
  await connectDB();

  const adminEmail = env.ADMIN_EMAIL.toLowerCase();

  const existingAdmin = await User.findOne({ email: adminEmail });

  if (!existingAdmin) {
    await User.create({
      userId: await createUniqueUserId(),
      fullName: env.ADMIN_NAME,
      name: env.ADMIN_NAME,
      email: adminEmail,
      password: env.ADMIN_PASSWORD,
      role: 'admin',
      permissions: ['admin'],
      isVerified: true,
      verificationStatus: 'approved',
      wallet: 0,
    });
  } else {
    existingAdmin.fullName = existingAdmin.fullName || env.ADMIN_NAME;
    existingAdmin.name = existingAdmin.name || env.ADMIN_NAME;
    if (!existingAdmin.userId) existingAdmin.userId = await createUniqueUserId();
    if (!existingAdmin.username) existingAdmin.username = existingAdmin.userId;
    existingAdmin.role = 'admin';
    existingAdmin.permissions = ['admin'];
    existingAdmin.isVerified = true;
    existingAdmin.verificationStatus = 'approved';

    if (!existingAdmin.password) {
      existingAdmin.password = env.ADMIN_PASSWORD;
    }

    await existingAdmin.save();
  }

  await upsertMany(Game, games, 'slug');
  await upsertMany(SportsCategory, sportsCategories, 'slug');

  for (const match of sportsMatches) {
    await SportsMatch.findOneAndUpdate(
      {
        tournament: match.tournament,
        'homeTeam.name': match.homeTeam.name,
        'awayTeam.name': match.awayTeam.name,
      },
      match,
      {
        upsert: true,
        new: true,
      }
    );
  }

  for (const item of content) {
    await PublicContent.findOneAndUpdate(
      {
        section: item.section,
        title: item.title,
      },
      item,
      {
        upsert: true,
        new: true,
      }
    );
  }

  console.log('Seed completed.');
  console.log(`Admin login: ${env.ADMIN_EMAIL} / ${env.ADMIN_PASSWORD}`);

  await mongoose.disconnect();
}

seed().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});