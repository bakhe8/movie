// Markets and platforms offered at onboarding (blueprint §4.1). They shape
// display and availability only -- never a taste prior (§4.1, §10.2).
// Markets are ISO 3166-1 alpha-2 codes; platforms are stable identifiers
// stored as-is on the profile.

export interface MarketOption {
  code: string;
  ar: string;
  en: string;
}

export interface PlatformOption {
  id: string;
  ar: string;
  en: string;
}

export const MARKETS: readonly MarketOption[] = [
  { code: 'SA', ar: 'السعودية', en: 'Saudi Arabia' },
  { code: 'AE', ar: 'الإمارات', en: 'United Arab Emirates' },
  { code: 'KW', ar: 'الكويت', en: 'Kuwait' },
  { code: 'QA', ar: 'قطر', en: 'Qatar' },
  { code: 'BH', ar: 'البحرين', en: 'Bahrain' },
  { code: 'OM', ar: 'عُمان', en: 'Oman' },
  { code: 'EG', ar: 'مصر', en: 'Egypt' },
  { code: 'JO', ar: 'الأردن', en: 'Jordan' },
  { code: 'LB', ar: 'لبنان', en: 'Lebanon' },
  { code: 'IQ', ar: 'العراق', en: 'Iraq' },
  { code: 'PS', ar: 'فلسطين', en: 'Palestine' },
  { code: 'SY', ar: 'سوريا', en: 'Syria' },
  { code: 'YE', ar: 'اليمن', en: 'Yemen' },
  { code: 'SD', ar: 'السودان', en: 'Sudan' },
  { code: 'LY', ar: 'ليبيا', en: 'Libya' },
  { code: 'TN', ar: 'تونس', en: 'Tunisia' },
  { code: 'DZ', ar: 'الجزائر', en: 'Algeria' },
  { code: 'MA', ar: 'المغرب', en: 'Morocco' },
  { code: 'TR', ar: 'تركيا', en: 'Türkiye' },
  { code: 'GB', ar: 'المملكة المتحدة', en: 'United Kingdom' },
  { code: 'US', ar: 'الولايات المتحدة', en: 'United States' },
  { code: 'CA', ar: 'كندا', en: 'Canada' },
  { code: 'DE', ar: 'ألمانيا', en: 'Germany' },
  { code: 'FR', ar: 'فرنسا', en: 'France' },
  { code: 'AU', ar: 'أستراليا', en: 'Australia' },
  { code: 'IN', ar: 'الهند', en: 'India' },
];

export const PLATFORMS: readonly PlatformOption[] = [
  { id: 'netflix', ar: 'نتفليكس', en: 'Netflix' },
  { id: 'shahid', ar: 'شاهد', en: 'Shahid' },
  { id: 'osn', ar: 'OSN+', en: 'OSN+' },
  { id: 'prime_video', ar: 'برايم فيديو', en: 'Prime Video' },
  { id: 'apple_tv', ar: 'Apple TV+', en: 'Apple TV+' },
  { id: 'disney_plus', ar: 'ديزني+', en: 'Disney+' },
  { id: 'starzplay', ar: 'ستارزبلاي', en: 'STARZPLAY' },
  { id: 'youtube', ar: 'يوتيوب', en: 'YouTube' },
  { id: 'cinema', ar: 'السينما', en: 'Cinema' },
];
