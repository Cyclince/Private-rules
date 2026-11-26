import packageMetadata from '../../package.json';

/** Single source of the application version, shared by server, web and Docker tags. */
export const APP_VERSION: string = packageMetadata.version;
