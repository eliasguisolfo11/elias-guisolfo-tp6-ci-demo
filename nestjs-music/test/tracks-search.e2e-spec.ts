import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { App } from 'supertest/types.js';
import request from 'supertest';
import {
  authenticatedRequest,
  viewerRequest,
} from './helpers/auth-test-context.js';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter.js';
import { AppModule } from '../src/app.module.js';

interface TrackResponse {
  TrackId: number;
  Name: string;
  AlbumId: number | null;
  GenreId: number | null;
  MediaTypeId: number;
  Composer: string | null;
  Milliseconds: number;
  Bytes: number | null;
  UnitPrice: number;
  Album: { AlbumId: number; Title: string } | null;
  Genre: { GenreId: number; Name: string | null } | null;
  MediaType: { MediaTypeId: number; Name: string };
}

interface AlbumResponse {
  Artist: { ArtistId: number; Name: string };
}

interface TrackSearchPage {
  items: TrackResponse[];
  total: number;
  skip: number;
  limit: number;
  hasMore: boolean;
}

const openRangeCases = [
  {
    parameter: 'minPrice',
    sort: 'UnitPrice',
    order: 'asc',
    getValue: (track: TrackResponse) => track.UnitPrice,
    getOutsideLimit: (value: number) => value + 0.01,
    isWithinLimit: (value: number, limit: number) => value >= limit,
  },
  {
    parameter: 'maxPrice',
    sort: 'UnitPrice',
    order: 'desc',
    getValue: (track: TrackResponse) => track.UnitPrice,
    getOutsideLimit: (value: number) => value - 0.01,
    isWithinLimit: (value: number, limit: number) => value <= limit,
  },
  {
    parameter: 'minDuration',
    sort: 'Milliseconds',
    order: 'asc',
    getValue: (track: TrackResponse) => track.Milliseconds,
    getOutsideLimit: (value: number) => value + 1,
    isWithinLimit: (value: number, limit: number) => value >= limit,
  },
  {
    parameter: 'maxDuration',
    sort: 'Milliseconds',
    order: 'desc',
    getValue: (track: TrackResponse) => track.Milliseconds,
    getOutsideLimit: (value: number) => value - 1,
    isWithinLimit: (value: number, limit: number) => value <= limit,
  },
] as const;

const literalSearchCases = [
  { label: 'porcentaje', text: '%', wildcardDecoy: true },
  { label: 'guion-bajo', text: '_', wildcardDecoy: true },
  { label: 'comilla-simple', text: "'" },
  { label: 'comilla-doble', text: '"' },
  { label: 'sql-like', text: "' OR 1=1 --" },
] as const;

describe('GET /tracks/search (e2e)', () => {
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

  it('combina los filtros AND, pagina y conserva las relaciones públicas', async () => {
    const trackResponse = await authenticatedRequest(app)
      .get('/tracks/1')
      .expect(200);
    const track = trackResponse.body as TrackResponse;
    expect(track.AlbumId).not.toBeNull();
    expect(track.Genre?.Name).toBeTruthy();

    const albumResponse = await authenticatedRequest(app)
      .get(`/albums/${track.AlbumId}`)
      .expect(200);
    const album = albumResponse.body as AlbumResponse;

    const response = await authenticatedRequest(app)
      .get('/tracks/search')
      .query({
        text: track.Name,
        genre: track.Genre?.Name,
        artist: album.Artist.Name,
        minPrice: track.UnitPrice,
        maxPrice: track.UnitPrice,
        minDuration: track.Milliseconds,
        maxDuration: track.Milliseconds,
        sort: 'Milliseconds',
        order: 'desc',
        skip: 0,
        limit: 1,
      })
      .expect(200);

    const page = response.body as TrackSearchPage;
    expect(page).toMatchObject({
      total: 1,
      skip: 0,
      limit: 1,
      hasMore: false,
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toEqual(track);
    expect(Object.keys(page).sort()).toEqual(
      ['hasMore', 'items', 'limit', 'skip', 'total'].sort(),
    );
  });

  it('aplica defaults y devuelve páginas vacías cuando skip supera las coincidencias', async () => {
    const defaultPageResponse = await authenticatedRequest(app)
      .get('/tracks/search')
      .expect(200);
    const defaultPage = defaultPageResponse.body as TrackSearchPage;

    expect(defaultPage.skip).toBe(0);
    expect(defaultPage.limit).toBe(100);
    expect(defaultPage.items).toHaveLength(100);
    expect(defaultPage.total).toBeGreaterThan(100);
    expect(defaultPage.hasMore).toBe(true);

    const emptyPageResponse = await authenticatedRequest(app)
      .get('/tracks/search')
      .query({ text: 'no existe esta pista', skip: 5000, limit: 2 })
      .expect(200);
    const emptyPage = emptyPageResponse.body as TrackSearchPage;

    expect(emptyPage).toMatchObject({
      items: [],
      total: 0,
      skip: 5000,
      limit: 2,
      hasMore: false,
    });
  });

  it('acepta el extremo inclusivo de MAX_SAFE_INTEGER para skip y duraciones', async () => {
    const maximumSafeInteger = '9007199254740991';
    const maximumSkipResponse = await authenticatedRequest(app)
      .get('/tracks/search')
      .query({ skip: maximumSafeInteger })
      .expect(200);
    const maximumSkipPage = maximumSkipResponse.body as TrackSearchPage;

    expect(maximumSkipPage.skip).toBe(9007199254740991);
    expect(maximumSkipPage.items).toEqual([]);

    await authenticatedRequest(app)
      .get('/tracks/search')
      .query({ minDuration: maximumSafeInteger })
      .expect(200);

    await authenticatedRequest(app)
      .get('/tracks/search')
      .query({ maxDuration: maximumSafeInteger })
      .expect(200);
  });

  it.each(['skip', 'minDuration', 'maxDuration'])(
    'rechaza %s por encima de MAX_SAFE_INTEGER',
    async (parameter) => {
      await authenticatedRequest(app)
        .get('/tracks/search')
        .query({ [parameter]: '9007199254740992' })
        .expect(400);
    },
  );

  it.each(openRangeCases)(
    'aplica $parameter de forma inclusiva cuando se envía solo ese límite',
    async ({
      parameter,
      sort,
      order,
      getValue,
      getOutsideLimit,
      isWithinLimit,
    }) => {
      const baselineResponse = await authenticatedRequest(app)
        .get('/tracks/search')
        .query({ sort, order, limit: 1 })
        .expect(200);
      const baselinePage = baselineResponse.body as TrackSearchPage;
      const boundaryTrack = baselinePage.items[0];
      if (!boundaryTrack) {
        throw new Error(`La búsqueda base no encontró pistas para ${parameter}.`);
      }

      const boundary = getValue(boundaryTrack);
      const inclusiveResponse = await authenticatedRequest(app)
        .get('/tracks/search')
        .query({ [parameter]: boundary, sort, order, limit: 1 })
        .expect(200);
      const inclusivePage = inclusiveResponse.body as TrackSearchPage;
      const inclusiveTrack = inclusivePage.items[0];
      if (!inclusiveTrack) {
        throw new Error(
          `El límite inclusivo de ${parameter} no devolvió la pista de borde.`,
        );
      }
      expect(inclusivePage.total).toBe(baselinePage.total);
      expect(inclusiveTrack.TrackId).toBe(boundaryTrack.TrackId);
      expect(getValue(inclusiveTrack)).toBe(boundary);

      const outsideLimit = getOutsideLimit(boundary);
      const outsideResponse = await authenticatedRequest(app)
        .get('/tracks/search')
        .query({ [parameter]: outsideLimit, sort, order, limit: 1 })
        .expect(200);
      const outsidePage = outsideResponse.body as TrackSearchPage;
      expect(outsidePage.total).toBeLessThan(inclusivePage.total);
      expect(outsidePage.items.map((track) => track.TrackId)).not.toContain(
        boundaryTrack.TrackId,
      );
      expect(
        outsidePage.items.every((track) =>
          isWithinLimit(getValue(track), outsideLimit),
        ),
      ).toBe(true);
    },
  );

  it('usa Name como orden predeterminado cuando order=desc y sort se omite', async () => {
    const defaultSortResponse = await authenticatedRequest(app)
      .get('/tracks/search')
      .query({ order: 'desc', limit: 10 })
      .expect(200);
    const explicitSortResponse = await authenticatedRequest(app)
      .get('/tracks/search')
      .query({ sort: 'Name', order: 'desc', limit: 10 })
      .expect(200);

    expect(defaultSortResponse.body).toEqual(explicitSortResponse.body);
  });

  it('rechaza parámetros desconocidos, arrays, rangos invertidos y overflow con 400', async () => {
    const overflowingPrice = `1${'0'.repeat(309)}`;
    const invalidQueries: Array<{
      query: string;
      message: string;
    }> = [
      {
        query: '?unexpected=value',
        message: 'El parámetro de búsqueda "unexpected" no está permitido.',
      },
      {
        query: '?text=rock&text=jazz',
        message: 'debe enviarse una sola vez como escalar.',
      },
      {
        query: '?text=&skip=-1',
        message: 'Los parámetros de búsqueda no son válidos.',
      },
      {
        query: '?skip=texto',
        message: 'Los parámetros de búsqueda no son válidos.',
      },
      {
        query: '?limit=texto',
        message: 'Los parámetros de búsqueda no son válidos.',
      },
      {
        query: '?minPrice=2&maxPrice=1',
        message: 'El precio mínimo no puede superar el máximo.',
      },
      {
        query: '?minPrice=0.10000000000000001&maxPrice=0.1',
        message: 'El precio mínimo no puede superar el máximo.',
      },
      {
        query: `?minPrice=${overflowingPrice}`,
        message: 'Los parámetros de búsqueda no son válidos.',
      },
      {
        query: `?maxPrice=${overflowingPrice}`,
        message: 'Los parámetros de búsqueda no son válidos.',
      },
      {
        query: '?minDuration=2000&maxDuration=1000',
        message: 'La duración mínima no puede superar la máxima.',
      },
      {
        query: '?minDuration=9007199254740992&maxDuration=9007199254740991',
        message: 'Los parámetros de búsqueda no son válidos.',
      },
      {
        query: '?minDuration=no-numerico',
        message: 'Los parámetros de búsqueda no son válidos.',
      },
    ];

    for (const invalidQuery of invalidQueries) {
      const response = await authenticatedRequest(app)
        .get(`/tracks/search${invalidQuery.query}`)
        .expect(400);

      expect(response.body.message).toContain(invalidQuery.message);
    }
  });

  it('acepta extremos de precio matemáticamente iguales con ceros iniciales y distinta escala', async () => {
    const response = await authenticatedRequest(app)
      .get('/tracks/search')
      .query({ minPrice: '0000.1000', maxPrice: '0.1' })
      .expect(200);

    expect((response.body as TrackSearchPage).items).toBeDefined();
  });

  it('filtra precios redondeados como Number con la misma precisión que 0.99', async () => {
    const trackNamePrefix = 'T8 Price Rounding Search Fixture';
    const fixtures: TrackResponse[] = [];

    for (const [priceName, UnitPrice] of [
      ['Low', 0.98],
      ['Boundary', 0.99],
      ['High', 1],
    ] as const) {
      const response = await authenticatedRequest(app)
        .post('/tracks')
        .send({
          Name: `${trackNamePrefix} ${priceName}`,
          AlbumId: null,
          GenreId: null,
          MediaTypeId: 1,
          Milliseconds: 123456,
          UnitPrice,
        })
        .expect(201);

      fixtures.push(response.body as TrackResponse);
    }

    const expectedTrackIds = (parameter: 'minPrice' | 'maxPrice'): number[] =>
      fixtures
        .filter((track) =>
          parameter === 'minPrice' ? track.UnitPrice >= 0.99 : track.UnitPrice <= 0.99,
        )
        .map((track) => track.TrackId)
        .sort((left, right) => left - right);

    for (const parameter of ['minPrice', 'maxPrice'] as const) {
      const exactResponse = await authenticatedRequest(app)
        .get('/tracks/search')
        .query({ text: trackNamePrefix, [parameter]: '0.99' })
        .expect(200);
      const roundedResponse = await authenticatedRequest(app)
        .get('/tracks/search')
        .query({ text: trackNamePrefix, [parameter]: '0.99000000000000001' })
        .expect(200);
      const exactPage = exactResponse.body as TrackSearchPage;
      const roundedPage = roundedResponse.body as TrackSearchPage;

      expect(exactPage.items.map((track) => track.TrackId).sort((a, b) => a - b)).toEqual(
        expectedTrackIds(parameter),
      );
      expect(roundedPage.items.map((track) => track.TrackId).sort((a, b) => a - b)).toEqual(
        expectedTrackIds(parameter),
      );
      expect(roundedPage.items).toEqual(exactPage.items);
    }
  });

  it('text busca solo Track.Name y artist busca el nombre relacionado', async () => {
    const artistName = 'T8 Artist Search Relation Only Sentinel';
    const createdArtist = await authenticatedRequest(app)
      .post('/artists')
      .send({ Name: artistName })
      .expect(201);
    const artist = createdArtist.body as { ArtistId: number; Name: string };

    const createdAlbum = await authenticatedRequest(app)
      .post('/albums')
      .send({ Title: 'T8 Album Search Relation Fixture', ArtistId: artist.ArtistId })
      .expect(201);
    const album = createdAlbum.body as { AlbumId: number };

    const createdTrack = await authenticatedRequest(app)
      .post('/tracks')
      .send({
        Name: 'T8 Track Search Relation Fixture',
        AlbumId: album.AlbumId,
        GenreId: null,
        MediaTypeId: 1,
        Milliseconds: 123456,
        UnitPrice: 0.99,
      })
      .expect(201);
    const track = createdTrack.body as TrackResponse;

    const artistSearch = await authenticatedRequest(app)
      .get('/tracks/search')
      .query({ artist: artistName })
      .expect(200);
    const artistPage = artistSearch.body as TrackSearchPage;
    expect(artistPage.total).toBe(1);
    expect(artistPage.items).toEqual([track]);

    const textSearch = await authenticatedRequest(app)
      .get('/tracks/search')
      .query({ text: artistName })
      .expect(200);
    const textPage = textSearch.body as TrackSearchPage;
    expect(textPage.total).toBe(0);
    expect(textPage.items.map((item) => item.TrackId)).not.toContain(track.TrackId);
  });

  it('requiere Bearer y permite la lectura a viewer y admin', async () => {
    await request(app.getHttpServer()).get('/tracks/search').expect(401);
    await request(app.getHttpServer())
      .get('/tracks/search')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);

    const viewerResponse = await viewerRequest(app)
      .get('/tracks/search')
      .query({ limit: 1 })
      .expect(200);
    expect((viewerResponse.body as TrackSearchPage).items).toHaveLength(1);

    const adminResponse = await authenticatedRequest(app)
      .get('/tracks/search')
      .query({ limit: 1 })
      .expect(200);
    expect((adminResponse.body as TrackSearchPage).items).toHaveLength(1);
  });

  it.each(literalSearchCases)(
    'busca literalmente por HTTP el caso $label y refleja el alta inmediata',
    async ({ label, text, wildcardDecoy }) => {
      const searchText = `T8-${label}-left${text}right`;
      const name = `T8 HTTP ${searchText}`;
      const createTrack = async (trackName: string): Promise<TrackResponse> => {
        const response = await authenticatedRequest(app)
          .post('/tracks')
          .send({
            Name: trackName,
            AlbumId: null,
            GenreId: null,
            MediaTypeId: 1,
            Milliseconds: 123456,
            UnitPrice: 0.99,
          })
          .expect(201);

        return response.body as TrackResponse;
      };
      const createdTrack = await createTrack(name);

      const immediateResponse = await authenticatedRequest(app)
        .get('/tracks/search')
        .query({ text: name })
        .expect(200);
      const immediatePage = immediateResponse.body as TrackSearchPage;
      expect(immediatePage.total).toBe(1);
      expect(immediatePage.items).toEqual([createdTrack]);

      if (wildcardDecoy) {
        await createTrack(`T8 decoy ${searchText.replace(`left${text}right`, 'leftXright')}`);
      }

      const literalResponse = await authenticatedRequest(app)
        .get('/tracks/search')
        .query({ text: searchText })
        .expect(200);
      const literalPage = literalResponse.body as TrackSearchPage;
      expect(literalPage.total).toBe(1);
      expect(literalPage.items.map((track) => track.TrackId)).toEqual([
        createdTrack.TrackId,
      ]);
      expect(literalPage.items[0]).toEqual(createdTrack);
    },
  );

  it('conserva las respuestas array y detalle de las rutas existentes', async () => {
    const listResponse = await viewerRequest(app)
      .get('/tracks')
      .query({ skip: 0, limit: 2 })
      .expect(200);
    expect(Array.isArray(listResponse.body)).toBe(true);
    expect(listResponse.body).toHaveLength(2);

    const detailResponse = await viewerRequest(app)
      .get('/tracks/1')
      .expect(200);
    expect(detailResponse.body).toMatchObject({ TrackId: 1, Album: { AlbumId: 1 } });
    expect(detailResponse.body).not.toHaveProperty('items');
  });
});
