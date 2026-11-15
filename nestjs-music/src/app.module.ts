import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AlbumsModule } from './albums/albums.module.js';
import { ArtistsModule } from './artists/artists.module.js';
import { DatabaseModule } from './database/database.module.js';
import { GenresModule } from './genres/genres.module.js';
import { TracksModule } from './tracks/tracks.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ReservationsModule } from './reservations/reservations.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

/**
 * `ConfigModule.forRoot()` lee `.env` en el momento en que se llama (no cuando
 * Nest termina de arrancar), así que `process.env` ya tiene los valores en la
 * línea siguiente. Por eso se guarda en una variable: así queda explícito que
 * el `.env` se carga *antes* de decidir si Observe se registra o no.
 */
const configModule = ConfigModule.forRoot({ isGlobal: true });

/**
 * Registra el módulo de Observe solo si hay credenciales reales de
 * https://observe.nestjs.com en el entorno.
 *
 * Sin ellas el agente manda telemetría sin autenticar y la consola se llena de
 * `Telemetry rejected (401)` cada pocos segundos.
 */
function observeModuleFromEnv(): DynamicModule | undefined {
  const appKey = process.env.OBSERVE_APP_KEY?.trim();
  const appSecret = process.env.OBSERVE_APP_SECRET?.trim();

  if (!appKey || !appSecret) {
    return undefined;
  }

  return ObserveModule.forRoot({
    appKey,
    appSecret,
    serviceId: 'nestjs-music',
  });
}

const observeModule = observeModuleFromEnv();

/** `true` cuando la instrumentación de Observe está realmente habilitada. */
export const observeEnabled = observeModule !== undefined;

@Module({
  imports: [
    configModule,
    ...(observeModule ? [observeModule] : []),
    DatabaseModule,
    AlbumsModule,
    ArtistsModule,
    GenresModule,
    TracksModule,
    AuthModule,
    ReservationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
