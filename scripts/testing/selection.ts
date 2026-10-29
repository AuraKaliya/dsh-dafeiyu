/** Test entry points accept existing source paths only; generated files are never discovery inputs. */
export function selectTests(available: readonly string[], args: readonly string[]) {
  const smoke = args.includes('--smoke'), check = args.includes('--check');
  const requested = args.filter(arg => arg !== '--smoke' && arg !== '--check');
  if (args.some(arg => arg.startsWith('-') && arg !== '--smoke' && arg !== '--check') || smoke && check) {
    throw new Error('TEST_ARGUMENT_INVALID');
  }
  if (requested.some(file => !available.includes(file)) || smoke && requested.length) throw new Error('TEST_FILE_NOT_ALLOWED');
  const files = [...new Set(requested.length ? requested : available.filter(file => file.startsWith('tests/smoke/') === smoke))].sort();
  if (!files.length) throw new Error('TEST_SELECTION_EMPTY');
  return { files, typecheck: check ? [...available] : files, suite: smoke ? 'smoke' : requested.length ? 'selected' : 'unit' };
}
