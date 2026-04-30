import { defaultCountry, findCountryByCode, findCountryByName, normalizeCountry } from './countries.js';

const COUNTRY_HEADER_NAMES = [
  'cf-ipcountry',
  'x-country-code',
  'x-client-country',
  'x-vercel-ip-country',
  'x-appengine-country',
  'cloudfront-viewer-country',
];

function cleanCountryCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '';
  if (code === 'XX' || code === 'T1') return '';
  return code;
}

function countryFromAcceptLanguage(headerValue) {
  const header = String(headerValue || '');
  const parts = header.split(',').map((item) => item.trim()).filter(Boolean);

  for (const part of parts) {
    const locale = part.split(';')[0].replace('_', '-');
    const region = locale.split('-').pop()?.toUpperCase();
    const country = cleanCountryCode(region) ? findCountryByCode(region) : null;
    if (country) return country;
  }

  return null;
}

export function detectCountryFromRequest(req) {
  for (const headerName of COUNTRY_HEADER_NAMES) {
    const country = findCountryByCode(cleanCountryCode(req.headers?.[headerName]));
    if (country) return country;
  }

  return countryFromAcceptLanguage(req.headers?.['accept-language']) || null;
}

export function resolveRegistrationCountry(req) {
  const bodyCountry = req.body?.countryCode || req.body?.country;
  if (bodyCountry) return normalizeCountry(bodyCountry);

  return detectCountryFromRequest(req) || defaultCountry;
}

export function currencyForResolvedCountry(country) {
  return String(country?.currency || defaultCountry.currency || 'BDT').toUpperCase();
}
