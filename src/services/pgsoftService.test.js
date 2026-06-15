import assert from 'node:assert/strict';
import test from 'node:test';
import {
  amountsEqual,
  buildPgsoftLaunchRequest,
  computePgsoftContentSha256,
  computePgsoftSignature,
  isGuid,
  isPgsoftCountryRestricted,
  money,
  normalizePgsoftLanguage,
  toMinorUnits,
  validateBetTransferAmount,
  validateRealTransferAmount,
} from './pgsoftService.js';
import { env } from '../config/env.js';

test('PG SOFT money values are truncated to two decimals', () => {
  assert.equal(toMinorUnits(11.129), 1112);
  assert.equal(toMinorUnits(-11.129), -1112);
  assert.equal(money(11.129), 11.12);
  assert.equal(money(-11.129), -11.12);
  assert.equal(amountsEqual(0.1 + 0.2, 0.3), true);
  assert.equal(validateBetTransferAmount({ winAmount: '0.30', betAmount: '0.20', transferAmount: '0.10' }), true);
});

test('1:1 currencies validate real_transfer_amount', () => {
  assert.equal(validateRealTransferAmount({ currency: 'BDT', transferAmount: -60, realTransferAmount: -60 }), true);
  assert.equal(validateRealTransferAmount({ currency: 'INR', transferAmount: 12.34, realTransferAmount: 12.35 }), false);
});

test('hash helper follows PG SOFT SHA256 and HMAC-SHA256 construction', () => {
  const body = 'operator_token=abc123&secret_key=a1b25cde5f3gh46ijkl&count=5000&bet_type=1&row_version=1346592723000';
  const hash = computePgsoftContentSha256(body);
  assert.equal(hash, '1700116101f424b9f6fc695b4dbaf2b7b0ee763ba1b3b53298e3069143ed46f1');
  assert.equal(
    computePgsoftSignature({
      salt: 'SALTEXAMPLE',
      host: 'apiexample.pgsoft.com',
      contentSha256: hash,
      date: '20190902',
    }),
    'd78220cf06ae85f9d1db11dad9c3fd926799619eab3d28574aadb8cf328cd7aa'
  );
});

test('site languages map to PG SOFT-supported values with English fallback', () => {
  assert.equal(normalizePgsoftLanguage('bn'), 'bn-BD');
  assert.equal(normalizePgsoftLanguage('hi'), 'hi-IN');
  assert.equal(normalizePgsoftLanguage('ur'), 'ur-PK');
  assert.equal(normalizePgsoftLanguage('si'), 'si-LK');
  assert.equal(normalizePgsoftLanguage('ne'), 'en');
});

test('restricted countries and GUID validation follow integration requirements', () => {
  assert.equal(isPgsoftCountryRestricted('US'), true);
  assert.equal(isPgsoftCountryRestricted('BD'), false);
  assert.equal(isGuid('b3f37e57-2873-40b1-aa95-f126c25ed311'), true);
  assert.equal(isGuid('not-a-guid'), false);
});


test('launch request uses the documented HTML Scheme fields', () => {
  const previous = {
    domain: env.PGSOFT_API_DOMAIN,
    token: env.PGSOFT_OPERATOR_TOKEN,
    exit: env.PGSOFT_GAME_EXIT_URL,
  };
  env.PGSOFT_API_DOMAIN = 'https://pg.example.test/';
  env.PGSOFT_OPERATOR_TOKEN = 'operator123';
  env.PGSOFT_GAME_EXIT_URL = 'https://7xbet.asia/pgsoft-games';

  try {
    const request = buildPgsoftLaunchRequest({
      session: {
        token: 'session-token',
        gameId: '126',
        language: 'bn',
        ip: '203.0.113.10',
        user: '507f1f77bcf86cd799439011',
      },
    });
    assert.match(request.url, /^https:\/\/pg\.example\.test\/external-game-launcher\/api\/v1\/GetLaunchURLHTML\?trace_id=/);
    assert.equal(request.body.get('operator_token'), 'operator123');
    assert.equal(request.body.get('path'), '/126/index.html');
    assert.equal(request.body.get('url_type'), 'game-entry');
    assert.equal(request.body.get('client_ip'), '203.0.113.10');
    const extra = new URLSearchParams(request.body.get('extra_args'));
    assert.equal(extra.get('ops'), 'session-token');
    assert.equal(extra.get('l'), 'bn-BD');
    assert.equal(extra.get('btt'), '1');
    assert.equal(extra.get('f'), 'https://7xbet.asia/pgsoft-games');
  } finally {
    env.PGSOFT_API_DOMAIN = previous.domain;
    env.PGSOFT_OPERATOR_TOKEN = previous.token;
    env.PGSOFT_GAME_EXIT_URL = previous.exit;
  }
});
