# TP-6 — CI público de demostración

Este repositorio contiene una copia limpia de la aplicación NestJS del TP-1 para demostrar el workflow de GitHub Actions y la protección de la rama principal. Se creó sin copiar el historial Git del repositorio de cursada ni sus archivos de planificación y evidencia privados.

La aplicación está en `nestjs-music/`. El workflow `.github/workflows/ci.yml` ejecuta lint, build, pruebas unitarias, e2e y cobertura en pull requests y al actualizar `main`.

No se incluyen credenciales. `.env` y los datos SQLite locales de autenticación y reservas están ignorados por Git; `.env.example` contiene solo valores vacíos o de ejemplo. No agregues secretos a este repositorio.