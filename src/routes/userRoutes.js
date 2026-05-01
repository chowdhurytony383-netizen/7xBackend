import express from 'express';
import {
  isAuthenticated,
  login,
  logout,
  myDetails,
  oneClickRegister,
  refreshToken,
  register,
  requestPasswordOtp,
  resendVerification,
  setNewPassword,
  updateProfile,
  updateProfilePicture,
  verifyEmail,
  verifyPasswordOtp,
} from '../controllers/authController.js';
import { getDayWiseWalletStats } from '../controllers/userStatsController.js';
import { getMyVerification, submitVerification, updateVerification } from '../controllers/verificationController.js';
import { protect } from '../middleware/auth.js';
import { profilePictureUpload, verificationUpload } from '../middleware/upload.js';

const router = express.Router();

router.post('/register', register);
router.post('/one-click-register', oneClickRegister);
router.post('/login', login);
router.post('/logout', logout);
router.post('/refresh-token', refreshToken);
router.get('/is-auth', protect, isAuthenticated);
router.get('/my-details', protect, myDetails);
router.patch('/update-user-details', protect, updateProfile);
router.patch('/profile-picture', protect, profilePictureUpload, updateProfilePicture);
router.patch('/update-profile-picture', protect, profilePictureUpload, updateProfilePicture);
router.get('/verify-user/:token', verifyEmail);
router.get('/verify-user', verifyEmail);
router.post('/resend-verification', resendVerification);
router.post('/reset-password', requestPasswordOtp);
router.post('/verify-reset-password-otp', verifyPasswordOtp);
router.post('/set-new-password', setNewPassword);
router.get('/get-day-wise-wallet-stats', protect, getDayWiseWalletStats);
router.get('/verification', protect, getMyVerification);
router.post('/verification', protect, verificationUpload, submitVerification);
router.patch('/verification', protect, verificationUpload, updateVerification);

export default router;
