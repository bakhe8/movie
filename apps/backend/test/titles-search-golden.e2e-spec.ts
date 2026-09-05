import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, type Repository } from 'typeorm';
import { AppModule } from '../src/modules/app/app.module';
import { LocalizedTitle } from '../src/entities/localized-title.entity';
import { Title } from '../src/entities/title.entity';

// The golden search set (remediation brief P1-01 / SEARCH-01). The brief's
// evidence was «Anora» returning nothing while «أنورا» returned one row, and
// the map could not reproduce it from the code: without a fixed set of
// queries with known answers, "search works" is an opinion. This is that set
// -- one case per way a user actually types a film's name: the other
// language, the wrong hamza, no accent, the wrong case, a fragment, and the
// name the film is known by somewhere else entirely (localized_titles).
//
// Every case asserts the expected title is *among* the results, never that
// it is alone: the catalogue this runs against also holds real titles, and a
// search that returns neighbours is correct.
async function registerUser(app: INestApplication) {
  const email = `golden-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const response = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: 'CorrectHorseBattery1', firstName: 'Golden', lastName: 'Set' })
    .expect(201);
  return response.body.access_token as string;
}

const SUFFIX = `${Date.now()}`;
const id = (key: string) => `E2E-GOLD-${key}-${SUFFIX}`;

interface Fixture {
  key: string;
  titleEn: string;
  titleAr: string;
  alternates?: { title: string; language: string; kind: LocalizedTitle['kind'] }[];
}

const FIXTURES: Fixture[] = [
  { key: 'ANORA', titleEn: 'Anora', titleAr: 'أنورا' },
  { key: 'AMELIE', titleEn: 'Amélie', titleAr: 'أميلي' },
  { key: 'RASHOMON', titleEn: 'Rashômon', titleAr: 'راشومون' },
  { key: 'LEON', titleEn: 'Léon: The Professional', titleAr: 'ليون' },
  { key: 'MAMA', titleEn: 'Y Tu Mamá También', titleAr: 'وأمك أيضاً' },
  { key: 'CAIRO', titleEn: 'Cairo Station', titleAr: 'باب الحديد' },
  { key: 'DREAMS', titleEn: 'Dreams of the Station', titleAr: 'أحلام المحطة' },
  { key: 'SCHOOL', titleEn: 'School of the Rebels', titleAr: 'مدرسة المشاغبين' },
  { key: 'MUSTAFA', titleEn: 'Mustafa the Ferryman', titleAr: 'مصطفى المعدّي' },
  { key: 'MESSAGE', titleEn: 'The Message', titleAr: 'الرِّسالة' },
  { key: 'NIGHTINGALE', titleEn: 'The Nightingale', titleAr: 'الــبلبل' },
  {
    key: 'WINGS',
    titleEn: 'Wings of Desire',
    titleAr: 'أجنحة الرغبة',
    alternates: [
      { title: 'Der Himmel über Berlin', language: 'de', kind: 'original' },
      { title: 'Der Himmel uber Berlin', language: 'de', kind: 'transliteration' },
    ],
  },
  {
    key: 'SAMURAI',
    titleEn: 'Seven Samurai',
    titleAr: 'الساموراي السبعة',
    alternates: [
      { title: '七人の侍', language: 'ja', kind: 'original' },
      { title: 'Shichinin no Samurai', language: 'ja', kind: 'transliteration' },
    ],
  },
  {
    key: 'PARASITE',
    titleEn: 'Parasite',
    titleAr: 'طفيلي',
    alternates: [
      { title: '기생충', language: 'ko', kind: 'original' },
      { title: 'Gisaengchung', language: 'ko', kind: 'transliteration' },
    ],
  },
  {
    key: 'DESTINY',
    titleEn: 'Destiny',
    titleAr: 'المصير',
    alternates: [{ title: 'Le Destin', language: 'fr', kind: 'official' }],
  },
];

// [what the user types, which fixture must come back, why this case exists]
const GOLDEN: [string, string, string][] = [
  // English, exactly as written and in either case (ILIKE).
  ['Anora', 'ANORA', 'english title, as written'],
  ['anora', 'ANORA', 'english title, lower case'],
  ['ANORA', 'ANORA', 'english title, upper case'],
  ['Cairo Station', 'CAIRO', 'two words, as written'],
  ['cairo station', 'CAIRO', 'two words, lower case'],
  ['CAIRO STATION', 'CAIRO', 'two words, upper case'],
  ['Wings of Desire', 'WINGS', 'english title with stop words'],
  ['Parasite', 'PARASITE', 'one-word english title'],
  ['parasite', 'PARASITE', 'one-word english title, lower case'],
  ['Seven Samurai', 'SAMURAI', 'english release title'],
  ['Destiny', 'DESTINY', 'english release title'],
  ['Léon: The Professional', 'LEON', 'english title with punctuation'],
  // Latin diacritics: typed with and without, in either case (unaccent).
  ['Amélie', 'AMELIE', 'accented title, typed with the accent'],
  ['Amelie', 'AMELIE', 'accented title, typed without it'],
  ['amelie', 'AMELIE', 'accented title, no accent and lower case'],
  ['AMELIE', 'AMELIE', 'accented title, no accent and upper case'],
  ['Rashômon', 'RASHOMON', 'circumflex, typed with it'],
  ['Rashomon', 'RASHOMON', 'circumflex, typed without it'],
  ['rashômon', 'RASHOMON', 'circumflex, lower case'],
  ['Leon', 'LEON', 'acute accent, typed without it'],
  ['Léon', 'LEON', 'acute accent, typed with it'],
  ['Y Tu Mama Tambien', 'MAMA', 'two accents, typed with neither'],
  ['Y Tu Mamá También', 'MAMA', 'two accents, typed with both'],
  ['y tu mama tambien', 'MAMA', 'two accents, none, lower case'],
  // Arabic, exactly as written.
  ['أنورا', 'ANORA', 'arabic title, as written'],
  ['باب الحديد', 'CAIRO', 'arabic title of an english-listed film'],
  ['أحلام المحطة', 'DREAMS', 'arabic title with hamza'],
  ['مدرسة المشاغبين', 'SCHOOL', 'arabic title with taa marbuta'],
  ['مصطفى المعدّي', 'MUSTAFA', 'arabic title with alef maqsura and shadda'],
  ['المصير', 'DESTINY', 'arabic title, as written'],
  ['أجنحة الرغبة', 'WINGS', 'arabic title, as written'],
  // Arabic folding: the letters people type interchangeably.
  ['انورا', 'ANORA', 'alef without hamza'],
  ['احلام المحطة', 'DREAMS', 'alef without hamza, mid-phrase'],
  ['مدرسه المشاغبين', 'SCHOOL', 'haa typed for taa marbuta'],
  ['مصطفي المعدي', 'MUSTAFA', 'yaa typed for alef maqsura, no shadda'],
  ['الرسالة', 'MESSAGE', 'stored with tashkeel, typed without'],
  ['الرساله', 'MESSAGE', 'tashkeel and taa marbuta, both folded'],
  ['البلبل', 'NIGHTINGALE', 'stored with tatweel, typed without'],
  ['الساموراي السبعه', 'SAMURAI', 'haa typed for taa marbuta'],
  ['اجنحة الرغبة', 'WINGS', 'alef without hamza'],
  // A fragment of a name is enough.
  ['Station', 'CAIRO', 'one word out of the english title'],
  ['نورا', 'ANORA', 'the middle of the arabic title'],
  ['Samurai', 'SAMURAI', 'one word out of the english title'],
  ['طفيل', 'PARASITE', 'a prefix of the arabic title'],
  // The name the film is known by somewhere else (localized_titles).
  ['Der Himmel über Berlin', 'WINGS', 'original-language title, with umlaut'],
  ['Der Himmel uber Berlin', 'WINGS', 'original-language title, without it'],
  ['himmel', 'WINGS', 'one word of the original title, lower case'],
  ['七人の侍', 'SAMURAI', 'original title in its own script'],
  ['Shichinin no Samurai', 'SAMURAI', 'transliteration of the original'],
  ['기생충', 'PARASITE', 'original title in its own script'],
  ['Gisaengchung', 'PARASITE', 'transliteration of the original'],
  ['Le Destin', 'DESTINY', 'official title in another market'],
  ['le destin', 'DESTINY', 'official title in another market, lower case'],
];

describe('Catalogue search: the golden set (real HTTP, real DB)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = await registerUser(app);

    const titles = app.get<Repository<Title>>(getRepositoryToken(Title));
    // Straight off the DataSource: `localized_titles` is read by the search
    // in SQL (an EXISTS subquery), so no module registers a repository for
    // it, and registering one just to seed a test would be backwards.
    const localized = app.get(DataSource).getRepository(LocalizedTitle);
    const saved = await titles.save(
      FIXTURES.map((fixture) => ({
        internalId: id(fixture.key),
        titleEn: fixture.titleEn,
        titleAr: fixture.titleAr,
        genres: ['Drama'],
      })),
    );
    const byKey = new Map(FIXTURES.map((fixture, index) => [fixture.key, saved[index].id]));
    const alternates = FIXTURES.flatMap((fixture) =>
      (fixture.alternates ?? []).map((alternate) => ({
        titleId: byKey.get(fixture.key) as string,
        title: alternate.title,
        language: alternate.language,
        kind: alternate.kind,
        region: null,
        displayPriority: 0,
        sourceRecordId: null,
      })),
    );
    await localized.save(alternates);
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  async function search(query: string): Promise<string[]> {
    const response = await request(app.getHttpServer())
      .get('/titles')
      .query({ query, limit: 100 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return (response.body.items as { internalId: string }[]).map((item) => item.internalId);
  }

  // Pinned, so a case quietly deleted to make a failure go away is visible
  // in the diff as a number (the brief asked for 50; the set grew to 53
  // while it was being written).
  it('still has all 53 cases', () => {
    expect(GOLDEN).toHaveLength(53);
  });

  it.each(GOLDEN)('«%s» finds %s (%s)', async (query, key) => {
    expect(await search(query)).toContain(id(key));
  });

  it('does not turn one film into several results because it has alternate titles', async () => {
    const results = await search('Der Himmel');
    expect(results.filter((internalId) => internalId === id('WINGS'))).toHaveLength(1);
  });

  it('still returns nothing for a name no title carries', async () => {
    expect(await search(`no-such-film-${SUFFIX}`)).toEqual([]);
  });
});
