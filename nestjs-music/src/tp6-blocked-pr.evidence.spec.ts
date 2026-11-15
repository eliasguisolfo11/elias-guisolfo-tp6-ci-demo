describe('Evidencia temporal del check requerido de TP-6', () => {
  it('falla deliberadamente para demostrar que CI bloquea el merge', () => {
    expect(false).toBe(true);
  });
});
