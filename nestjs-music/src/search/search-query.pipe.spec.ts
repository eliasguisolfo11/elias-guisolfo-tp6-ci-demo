import { BadRequestException } from '@nestjs/common';
import { SearchQueryPipe, albumSearchQueryParameters, trackSearchQueryParameters } from './search-query.pipe.js';
import { SearchAlbumsQueryDto } from '../albums/dto/search-albums-query.dto.js';
import { SearchTracksQueryDto } from '../tracks/dto/search-tracks-query.dto.js';

const tracksPipe = new SearchQueryPipe(
  SearchTracksQueryDto,
  trackSearchQueryParameters,
);
const albumsPipe = new SearchQueryPipe(
  SearchAlbumsQueryDto,
  albumSearchQueryParameters,
);

describe('SearchQueryPipe', () => {
  it('applies the resource defaults and parses valid Track filters', () => {
    const query = tracksPipe.transform({
      text: '  Black   Dog  ',
      genre: ' Rock ',
      artist: ' Led Zeppelin ',
      minPrice: '0.99',
      maxPrice: '1',
      minDuration: '1000',
      maxDuration: '2000',
      skip: '2',
      limit: '10',
      order: 'DeSc',
    });

    expect(query).toMatchObject({
      text: 'Black   Dog',
      genre: 'Rock',
      artist: 'Led Zeppelin',
      minPrice: 0.99,
      maxPrice: 1,
      minDuration: 1000,
      maxDuration: 2000,
      skip: 2,
      limit: 10,
      sort: 'Name',
      order: 'desc',
    });
  });

  it('uses Album-specific defaults and accepts only its textual filters', () => {
    const query = albumsPipe.transform({ text: ' Kind of Blue ', artist: ' Miles Davis ' });

    expect(query).toMatchObject({
      text: 'Kind of Blue',
      artist: 'Miles Davis',
      skip: 0,
      limit: 100,
      sort: 'Title',
      order: 'asc',
    });
  });

  it('accepts the maximum safe integer for skip and duration bounds', () => {
    expect(
      tracksPipe.transform({
        skip: '9007199254740991',
        minDuration: '9007199254740991',
        maxDuration: '9007199254740991',
      }),
    ).toMatchObject({
      skip: 9007199254740991,
      minDuration: 9007199254740991,
      maxDuration: 9007199254740991,
    });
    expect(albumsPipe.transform({ skip: '9007199254740991' }).skip).toBe(
      9007199254740991,
    );
  });

  it.each([
    ['skip on Tracks', tracksPipe, { skip: '9007199254740992' }],
    ['skip on Albums', albumsPipe, { skip: '9007199254740992' }],
    ['minDuration', tracksPipe, { minDuration: '9007199254740992' }],
    ['maxDuration', tracksPipe, { maxDuration: '9007199254740992' }],
  ])('rejects %s above MAX_SAFE_INTEGER', (_description, pipe, query) => {
    expect(() => pipe.transform(query)).toThrow(BadRequestException);
  });

  it('rejects unknown query parameters before DTO transformation', () => {
    expect(() => tracksPipe.transform({ text: 'Rock', debug: 'true' })).toThrow(
      BadRequestException,
    );
  });

  it.each([
    ['Tracks-only genre', { genre: 'Rock' }],
    ['Tracks-only minimum price', { minPrice: '0.99' }],
    ['Tracks-only maximum duration', { maxDuration: '1000' }],
  ])('rejects %s on Albums', (_description, query) => {
    expect(() => albumsPipe.transform(query)).toThrow(BadRequestException);
  });

  it.each([
    ['an array for a repeated text key', { text: ['rock', 'jazz'] }],
    ['an array for a repeated numeric key', { skip: ['0', '1'] }],
  ])('rejects %s', (_description, query) => {
    expect(() => tracksPipe.transform(query)).toThrow(BadRequestException);
  });

  it.each([
    ['a non-integer skip', { skip: '1.5' }],
    ['a negative skip', { skip: '-1' }],
    ['an empty skip', { skip: '' }],
    ['a non-integer limit', { limit: '2.5' }],
    ['a zero limit', { limit: '0' }],
    ['a limit above 100', { limit: '101' }],
    ['an unsupported Track sort field', { sort: 'ArtistName' }],
    ['an invalid sort direction', { order: 'sideways' }],
  ])('rejects %s', (_description, query) => {
    expect(() => tracksPipe.transform(query)).toThrow(BadRequestException);
  });

  it('rejects an unsupported Album sort field', () => {
    expect(() => albumsPipe.transform({ sort: 'UnitPrice' })).toThrow(
      BadRequestException,
    );
  });

  it.each([
    ['empty text', { text: '' }],
    ['whitespace-only text', { text: '   ' }],
    ['whitespace-only genre', { genre: '   ' }],
    ['whitespace-only artist', { artist: '   ' }],
  ])('rejects %s after trimming', (_description, query) => {
    expect(() => tracksPipe.transform(query)).toThrow(BadRequestException);
  });

  it.each([
    ['an empty price', { minPrice: '' }],
    ['a non-numeric price', { minPrice: 'free' }],
    ['a negative price', { maxPrice: '-0.01' }],
    ['an empty duration', { minDuration: '' }],
    ['a decimal duration', { maxDuration: '1000.5' }],
    ['a negative duration', { minDuration: '-1' }],
  ])('rejects %s', (_description, query) => {
    expect(() => tracksPipe.transform(query)).toThrow(BadRequestException);
  });

  it('rejects inverted decimal ranges before Number rounds the values equally', () => {
    expect(() =>
      tracksPipe.transform({ minPrice: '0.10000000000000001', maxPrice: '0.1' }),
    ).toThrow(BadRequestException);
  });

  it('accepts mathematically equal decimal bounds with different precision', () => {
    expect(
      tracksPipe.transform({ minPrice: '0000.1000', maxPrice: '0.1' }),
    ).toMatchObject({ minPrice: 0.1, maxPrice: 0.1 });
  });

  it('rounds finite minPrice and maxPrice bounds using JavaScript Number precision', () => {
    const price = '0.99000000000000001';

    expect(tracksPipe.transform({ minPrice: price }).minPrice).toBe(0.99);
    expect(tracksPipe.transform({ maxPrice: price }).maxPrice).toBe(0.99);
  });

  it('accepts large finite minPrice and maxPrice bounds without an application cap', () => {
    const largeFinitePrice = `1${'0'.repeat(308)}`;

    expect(tracksPipe.transform({ minPrice: largeFinitePrice }).minPrice).toBe(1e308);
    expect(tracksPipe.transform({ maxPrice: largeFinitePrice }).maxPrice).toBe(1e308);
  });

  it('rejects a price bound whose Number conversion is non-finite', () => {
    const overflowingPrice = `1${'0'.repeat(309)}`;

    expect(() => tracksPipe.transform({ minPrice: overflowingPrice })).toThrow(BadRequestException);
    expect(() => tracksPipe.transform({ maxPrice: overflowingPrice })).toThrow(BadRequestException);
  });

  it('accepts open decimal ranges without comparing a missing endpoint', () => {
    expect(() =>
      tracksPipe.transform({ minPrice: '0.10000000000000001' }),
    ).not.toThrow();
    expect(() => tracksPipe.transform({ maxPrice: '0.1' })).not.toThrow();
  });

  it('leaves inverted integer duration range checks to the service', () => {
    expect(() =>
      tracksPipe.transform({ minDuration: '200', maxDuration: '100' }),
    ).not.toThrow();
  });
});
