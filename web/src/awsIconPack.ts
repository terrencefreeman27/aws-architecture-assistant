import { buildIconPack } from '../../shared/awsIcons';

/**
 * The vendored AWS Architecture Icons, bundled at build time (no runtime
 * fetch). Imported lazily together with Mermaid, so the icons ship in the
 * diagram chunk rather than the main bundle.
 */
const files = import.meta.glob('../../vendor/aws-architecture-icons/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export const awsIconPack = buildIconPack(Object.fromEntries(Object.entries(files).map(([path, svg]) => [path.slice(path.lastIndexOf('/') + 1), svg])));
