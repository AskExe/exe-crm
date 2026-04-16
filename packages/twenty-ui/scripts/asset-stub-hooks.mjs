// Node ESM loader hooks — intercepts image imports and returns a stub module
// whose default export stringifies to a known placeholder. The generator
// then post-processes the placeholder into the real data: URL (or carries
// forward the existing one from theme-{dark,light}.css).

const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|svg|webp|avif)(\?.*)?$/i;

const STUB_SOURCE = `export default { toString: () => "__NOISY_PLACEHOLDER__" };`;

export const resolve = async (specifier, context, nextResolve) => {
  if (IMAGE_EXTENSIONS.test(specifier)) {
    return {
      url: `stub-image:${specifier}`,
      format: 'module',
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
};

export const load = async (url, context, nextLoad) => {
  if (url.startsWith('stub-image:') || IMAGE_EXTENSIONS.test(url)) {
    return {
      format: 'module',
      source: STUB_SOURCE,
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
};
