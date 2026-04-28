import express from 'express';
import passport from 'passport';
import { env } from '../config/env.js';
import { devFacebook, devGoogle, oauthFailure, oauthSuccess } from '../controllers/oauthController.js';

const router = express.Router();

if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'], session: false }));
  router.get('/google/callback', passport.authenticate('google', { failureRedirect: '/api/auth/failure', session: false }), oauthSuccess);
} else {
  router.get('/google', devGoogle);
}

if (env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET) {
  router.get('/facebook', passport.authenticate('facebook', { scope: ['email'], session: false }));
  router.get('/facebook/callback', passport.authenticate('facebook', { failureRedirect: '/api/auth/failure', session: false }), oauthSuccess);
} else {
  router.get('/facebook', devFacebook);
}

router.get('/failure', oauthFailure);
export default router;
