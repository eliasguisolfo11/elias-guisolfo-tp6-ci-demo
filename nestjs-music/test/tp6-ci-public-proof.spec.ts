describe('TP-6 public branch protection proof', () => {
  it('intentionally fails so the required CI check blocks the PR', () => {
    expect('CI').toBe('green');
  });
});
