import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as FacebookStrategy } from 'passport-facebook';
import { env } from './env.js';
import { serializeOAuthUser } from '../controllers/oauthController.js';

export function configurePassport() {
  passport.serializeUser((user, done) => done(null, user._id));
  passport.deserializeUser((id, done) => done(null, { _id: id }));

  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
      clientID: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${env.OAUTH_CALLBACK_BASE_URL}/api/auth/google/callback`,
    }, async (_accessToken, _refreshToken, profile, done) => {
      try { done(null, await serializeOAuthUser(profile, 'google')); }
      catch (error) { done(error); }
    }));
  }

  if (env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET) {
    passport.use(new FacebookStrategy({
      clientID: env.FACEBOOK_APP_ID,
      clientSecret: env.FACEBOOK_APP_SECRET,
      callbackURL: `${env.OAUTH_CALLBACK_BASE_URL}/api/auth/facebook/callback`,
      profileFields: ['id', 'displayName', 'emails'],
    }, async (_accessToken, _refreshToken, profile, done) => {
      try { done(null, await serializeOAuthUser(profile, 'facebook')); }
      catch (error) { done(error); }
    }));
  }
}
