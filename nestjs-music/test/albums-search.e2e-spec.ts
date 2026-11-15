import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { App } from 'supertest/types.js';
import request from 'supertest';
import {
  authenticatedRequest,
  viewerRequest,
} from './helpers/auth-test-context.js';
import { AppModule } from '../src/app.module.js';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter.js';

interface AlbumResponse {
  AlbumId: number;
  Title: string;
  ArtistId: number;
  Artist: {
    ArtistId: number;
    Name: string;
  };
}

interface AlbumSearchPage {
  items: AlbumResponse[];
  total: number;
  skip: number;
  limit: number;
  hasMore: boolean;
}

const literalSearchCases = [
  { label: 'porcentaje', text: '%', wildcardDecoy: true },
  { label: 'guion-bajo', text: '_', wildcardDecoy: true },
  { label: 'comilla-simple', text: "'" },
  { label: 'comilla-doble', text: '"' },
  { label: 'sql-like', text: "' OR 1=1 --" },
] as const;

describe('GET /albums/search (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('combina texto y artista, ignora mayúsculas y espacios exteriores', async () => {
    const albumResponse = await authenticatedRequest(app)
      .get('/albums/1')
      .expect(200);
    const album = albumResponse.body as AlbumResponse;

    const response = await authenticatedRequest(app)
      .get('/albums/search')
      .query({
        text: `  ${album.Title.toUpperCase()}  `,
        artist: album.Artist.Name.toLowerCase(),
      })
      .expect(200);

    const page = response.body as AlbumSearchPage;
    expect(page.items.map((item) => item.AlbumId)).toContain(album.AlbumId);
    expect(page.items).toContainEqual(album);
    expect(page).toMatchObject({
      skip: 0,
      limit: 100,
      total: page.items.length,
      hasMore: false,
    });
    expect(Object.keys(page).sort()).toEqual(
      ['hasMore', 'items', 'limit', 'skip', 'total'].sort(),
    );

    const noAndMatch = await authenticatedRequest(app)
      .get('/albums/search')
      .query({ text: album.Title, artist: 'artista inexistente' })
      .expect(200);
    expect(noAndMatch.body).toMatchObject({
      items: [],
      total: 0,
      skip: 0,
      limit: 100,
      hasMore: false,
    });
  });

  it('busca text solo en Album.Title y artist en Artist.Name', async () => {
    const sentinel = `T9 artist-only sentinel ${Date.now()}`;
    const title = `T9 album with a different title ${Date.now()}`;
    const artistResponse = await authenticatedRequest(app)
      .post('/artists')
      .send({ Name: sentinel })
      .expect(201);
    const artist = artistResponse.body as AlbumResponse['Artist'];

    const albumResponse = await authenticatedRequest(app)
      .post('/albums')
      .send({ Title: title, ArtistId: artist.ArtistId })
      .expect(201);
    const album = albumResponse.body as AlbumResponse;

    const byArtistResponse = await authenticatedRequest(app)
      .get('/albums/search')
      .query({ artist: sentinel })
      .expect(200);
    const byArtistPage = byArtistResponse.body as AlbumSearchPage;
    expect(byArtistPage.total).toBe(1);
    expect(byArtistPage.items).toEqual([album]);

    const byTextResponse = await authenticatedRequest(app)
      .get('/albums/search')
      .query({ text: sentinel })
      .expect(200);
    const byTextPage = byTextResponse.body as AlbumSearchPage;
    expect(byTextPage.total).toBe(0);
    expect(byTextPage.items).toEqual([]);
    expect(byTextPage.items).not.toContainEqual(
      expect.objectContaining({ AlbumId: album.AlbumId }),
    );
  });

  it('aplica defaults y devuelve páginas y resultados vacíos con el mismo sobre', async () => {
    const defaultResponse = await authenticatedRequest(app)
      .get('/albums/search')
      .expect(200);
    const defaultPage = defaultResponse.body as AlbumSearchPage;

    expect(defaultPage.skip).toBe(0);
    expect(defaultPage.limit).toBe(100);
    expect(defaultPage.items).toHaveLength(100);
    expect(defaultPage.total).toBeGreaterThan(100);
    expect(defaultPage.hasMore).toBe(true);
    expect(defaultPage.items[0]?.Artist).toMatchObject({
      ArtistId: expect.any(Number),
      Name: expect.any(String),
    });

    const pageResponse = await authenticatedRequest(app)
      .get('/albums/search')
      .query({ skip: 1, limit: 2 })
      .expect(200);
    const page = pageResponse.body as AlbumSearchPage;

    expect(page).toMatchObject({
      total: defaultPage.total,
      skip: 1,
      limit: 2,
      hasMore: true,
    });
    expect(page.items).toEqual(defaultPage.items.slice(1, 3));

    const emptyResponse = await authenticatedRequest(app)
      .get('/albums/search')
      .query({ text: 'sin coincidencias de álbum' })
      .expect(200);
    expect(emptyResponse.body).toMatchObject({
      items: [],
      total: 0,
      skip: 0,
      limit: 100,
      hasMore: false,
    });
  });

  it('rechaza un skip por encima de MAX_SAFE_INTEGER', async () => {
    await authenticatedRequest(app)
      .get('/albums/search')
      .query({ skip: '9007199254740992' })
      .expect(400);
  });

  it('acepta el skip máximo y conserva una página vacía', async () => {
    const maximumSafeInteger = Number.MAX_SAFE_INTEGER;
    const response = await authenticatedRequest(app)
      .get('/albums/search')
      .query({ skip: String(maximumSafeInteger) })
      .expect(200);
    const page = response.body as AlbumSearchPage;

    expect(page.skip).toBe(maximumSafeInteger);
    expect(page.limit).toBe(100);
    expect(page.total).toBeGreaterThan(0);
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it('usa Title como orden predeterminado cuando order=desc y sort se omite', async () => {
    const defaultSortResponse = await authenticatedRequest(app)
      .get('/albums/search')
      .query({ order: 'desc', limit: 10 })
      .expect(200);
    const explicitSortResponse = await authenticatedRequest(app)
      .get('/albums/search')
      .query({ sort: 'Title', order: 'desc', limit: 10 })
      .expect(200);

    expect(defaultSortResponse.body).toEqual(explicitSortResponse.body);
  });

  it('rechaza parámetros desconocidos, no admitidos, repetidos o vacíos', async () => {
    const invalidQueries = [
      '?unexpected=value',
      '?genre=rock',
      '?text=first&text=second',
      '?text=%20%20',
    ];

    for (const query of invalidQueries) {
      const response = await authenticatedRequest(app)
        .get(`/albums/search${query}`)
        .expect(400);

      expect(response.body.code).toBe(400);
      expect(response.body.message).not.toBe(
        'El id debe ser un entero no negativo.',
      );
    }
  });

  it.each([
    { parameter: 'skip', query: { skip: 'texto' } },
    { parameter: 'limit', query: { limit: 'texto' } },
  ])('responde HTTP 400 cuando $parameter no es numérico', async ({ query }) => {
    const response = await authenticatedRequest(app)
      .get('/albums/search')
      .query(query)
      .expect(400);

    expect(response.body.code).toBe(400);
  });

  it('requiere Bearer y permite la lectura a viewer y admin', async () => {
    await request(app.getHttpServer()).get('/albums/search').expect(401);
    await request(app.getHttpServer())
      .get('/albums/search')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);

    const viewerResponse = await viewerRequest(app)
      .get('/albums/search')
      .query({ limit: 1 })
      .expect(200);
    expect((viewerResponse.body as AlbumSearchPage).items).toHaveLength(1);

    const adminResponse = await authenticatedRequest(app)
      .get('/albums/search')
      .query({ limit: 1 })
      .expect(200);
    expect((adminResponse.body as AlbumSearchPage).items).toHaveLength(1);
  });

  it.each(literalSearchCases)(
    'busca literalmente por HTTP el caso $label y refleja el alta inmediata',
    async ({ label, text, wildcardDecoy }) => {
      const existingAlbumResponse = await authenticatedRequest(app)
        .get('/albums/1')
        .expect(200);
      const artistId = (existingAlbumResponse.body as AlbumResponse).ArtistId;
      const searchText = `T9-${label}-left${text}right`;
      const title = `T9 HTTP ${searchText}`;
      const createAlbum = async (albumTitle: string): Promise<AlbumResponse> => {
        const response = await authenticatedRequest(app)
          .post('/albums')
          .send({ Title: albumTitle, ArtistId: artistId })
          .expect(201);

        return response.body as AlbumResponse;
      };
      const createdAlbum = await createAlbum(title);

      const immediateResponse = await authenticatedRequest(app)
        .get('/albums/search')
        .query({ text: title })
        .expect(200);
      const immediatePage = immediateResponse.body as AlbumSearchPage;
      expect(immediatePage.total).toBe(1);
      expect(immediatePage.items).toEqual([createdAlbum]);

      if (wildcardDecoy) {
        await createAlbum(
          `T9 decoy ${searchText.replace(`left${text}right`, 'leftXright')}`,
        );
      }

      const literalResponse = await authenticatedRequest(app)
        .get('/albums/search')
        .query({ text: searchText })
        .expect(200);
      const literalPage = literalResponse.body as AlbumSearchPage;
      expect(literalPage.total).toBe(1);
      expect(literalPage.items.map((album) => album.AlbumId)).toEqual([
        createdAlbum.AlbumId,
      ]);
      expect(literalPage.items[0]).toEqual(createdAlbum);
    },
  );

  it('conserva el formato array y el detalle de las rutas existentes', async () => {
    const listResponse = await viewerRequest(app)
      .get('/albums')
      .query({ skip: 0, limit: 2 })
      .expect(200);
    expect(Array.isArray(listResponse.body)).toBe(true);
    expect(listResponse.body).toHaveLength(2);
    expect(listResponse.body[0]).toHaveProperty('Artist');

    const detailResponse = await viewerRequest(app)
      .get('/albums/1')
      .expect(200);
    expect(detailResponse.body).toMatchObject({
      AlbumId: 1,
      Artist: { ArtistId: expect.any(Number), Name: expect.any(String) },
    });
    expect(detailResponse.body).not.toHaveProperty('items');
  });
});
