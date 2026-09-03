import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { DatabaseConfig } from '../config/database.config';
import { Title } from '../entities/title.entity';

type SeedTitle = Pick<Title, 'internalId' | 'titleEn' | 'titleAr' | 'description' | 'releaseYear' | 'genres' | 'fingerprint'>;
type FilmSeedRow = [string, string, string, string, number, string[], number[]];

const filmRows: FilmSeedRow[] = [
  ['FILM001', 'Arrival', 'الوصول', 'A linguist investigates the language of visitors from another world.', 2016, ['Science Fiction', 'Drama'], [0.35, 0.45, 0.9, 0.85, 0.55, 0.45, 0.4, 0.65, 0.15, 0.8, 0.7, 0.7, 0.45]],
  ['FILM002', 'Inception', 'استهلال', 'A thief enters dreams to plant an idea in a target.', 2010, ['Science Fiction', 'Thriller'], [0.7, 0.75, 0.85, 0.7, 0.25, 0.55, 0.65, 0.55, 0.6, 0.9, 0.85, 0.9, 0.4]],
  ['FILM003', 'The Grand Budapest Hotel', 'فندق بودابست الكبير', 'A hotel concierge and lobby boy navigate a stolen painting and a family fortune.', 2014, ['Comedy', 'Drama'], [0.65, 0.45, 0.25, 0.4, 0.85, 0.15, 0.8, 0.75, 0.15, 0.55, 0.9, 0.65, 0.8]],
  ['FILM004', 'Parasite', 'طفيلي', 'A struggling family infiltrates the household of a wealthy family.', 2019, ['Thriller', 'Drama'], [0.7, 0.75, 0.7, 0.75, 0.35, 0.65, 0.7, 0.7, 0.35, 0.85, 0.7, 0.7, 0.5]],
  ['FILM005', 'Spirited Away', 'المخطوفة', 'A young girl enters a spirit world and must find her way home.', 2001, ['Animation', 'Fantasy'], [0.55, 0.7, 0.65, 0.55, 0.75, 0.3, 0.55, 0.45, 0.35, 0.7, 0.95, 0.9, 0.85]],
  ['FILM006', 'Mad Max: Fury Road', 'ماد ماكس: طريق الغضب', 'A rebel and a drifter flee across a wasteland from a warlord.', 2015, ['Action', 'Science Fiction'], [0.95, 0.8, 0.15, 0.3, 0.25, 0.75, 0.85, 0.15, 1, 0.35, 0.9, 0.95, 0.65]],
  ['FILM007', 'Moonlight', 'ضوء القمر', 'A young man confronts identity and intimacy across three chapters of his life.', 2016, ['Drama'], [0.3, 0.5, 0.45, 0.9, 0.7, 0.4, 0.75, 0.8, 0.05, 0.55, 0.75, 0.75, 0.6]],
  ['FILM008', 'The Matrix', 'المصفوفة', 'A hacker discovers that reality is a simulated world.', 1999, ['Science Fiction', 'Action'], [0.75, 0.65, 0.8, 0.5, 0.2, 0.6, 0.55, 0.4, 0.8, 0.75, 0.85, 0.85, 0.35]],
  ['FILM009', 'The Handmaiden', 'الخادمة', 'A con woman enters a wealthy household with a plan that does not unfold as expected.', 2016, ['Thriller', 'Romance'], [0.55, 0.75, 0.9, 0.8, 0.4, 0.6, 0.55, 0.75, 0.25, 0.9, 0.9, 0.75, 0.65]],
  ['FILM010', 'Paddington 2', 'بادينغتون 2', 'A kind bear is framed for theft and his family works to clear his name.', 2017, ['Family', 'Comedy'], [0.55, 0.4, 0.1, 0.25, 1, 0.05, 0.9, 0.65, 0.2, 0.35, 0.75, 0.65, 0.75]],
  ['FILM011', 'Blade Runner 2049', 'بليد رانر 2049', 'A replicant hunter uncovers a secret that could reshape society.', 2017, ['Science Fiction', 'Drama'], [0.3, 0.5, 0.85, 0.7, 0.25, 0.8, 0.6, 0.55, 0.35, 0.8, 0.95, 0.95, 0.3]],
  ['FILM012', 'Whiplash', 'ويبلاش', 'An ambitious drummer is pushed to his limits by an exacting instructor.', 2014, ['Drama', 'Music'], [0.8, 0.7, 0.25, 0.8, 0.25, 0.65, 0.8, 0.8, 0.25, 0.65, 0.75, 1, 0.4]],
  ['FILM013', "Pan's Labyrinth", 'متاهة بان', 'A girl escapes into a dark fairy tale during the Spanish Civil War.', 2006, ['Fantasy', 'Drama'], [0.45, 0.65, 0.8, 0.65, 0.45, 0.75, 0.55, 0.5, 0.35, 0.75, 0.95, 0.8, 0.55]],
  ['FILM014', 'Before Sunrise', 'قبل الشروق', 'Two strangers spend a night talking as they walk through Vienna.', 1995, ['Romance', 'Drama'], [0.25, 0.35, 0.3, 0.75, 0.85, 0.15, 0.95, 1, 0.05, 0.4, 0.6, 0.6, 0.65]],
  ['FILM015', 'Get Out', 'اخرج', "A young man uncovers a terrifying secret while visiting his girlfriend's family.", 2017, ['Horror', 'Thriller'], [0.6, 0.75, 0.7, 0.65, 0.25, 0.75, 0.8, 0.65, 0.45, 0.75, 0.7, 0.75, 0.45]],
];

const films: SeedTitle[] = filmRows.map(([internalId, titleEn, titleAr, description, releaseYear, genres, values]) => ({
  internalId,
  titleEn,
  titleAr,
  description,
  releaseYear,
  genres,
  fingerprint: {
    schemaVersion: 'film-fingerprint-v1',
    pacing: values[0], rhythmVariance: values[1], ambiguity: values[2], psychologicalDepth: values[3],
    warmth: values[4], darkness: values[5], linearity: values[6], dialogueDensity: values[7],
    actionIntensity: values[8], plotComplexity: values[9], visualComplexity: values[10],
    soundscapeComplexity: values[11], colorSaturation: values[12],
    themes: [],
    // Hand-entered placeholder data for local dev, not extracted or
    // rights-cleared -- honest "unknown" rather than a fabricated claim.
    confidence: {},
    sourceIds: ['manual-seed'],
    extractorVersion: 'manual-seed-v1',
    licenseStatus: 'unknown',
    reviewStatus: 'unreviewed',
  },
}));

async function seed(): Promise<void> {
  const dataSource = new DataSource(DatabaseConfig() as DataSourceOptions);
  await dataSource.initialize();
  await dataSource.getRepository(Title).upsert(films, ['internalId']);
  console.log(`Seeded ${films.length} titles`);
  await dataSource.destroy();
}

seed().catch((error) => {
  console.error('Failed to seed titles:', error);
  process.exit(1);
});