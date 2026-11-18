// Branch `server` (dono, 18/11: "quero em outra branch") — this build is the "Donel Dev Server", installed side by
// side with the Alfa on the same PC. Each one has its own install (appId), data folder (`app.setName`) and update
// feed, so neither overwrites nor updates the other. electron-builder.yml carries the same values (a test keeps them
// in sync). Copying settings from the Alfa: docs/canal-server.md.

export const APP_IDENTITY = {
  /** The channel name of this build (`appChannelName`, update state folder). */
  edition: 'server',
  /** What the owner sees: window, shortcut, installer, exe. */
  productName: 'Donel Dev Server',
  /** `app.setName` — the `userData` folder (`%APPDATA%\donel-dev-server`); the Alfa uses `donel-dev`. */
  appName: 'donel-dev-server',
  /** Installer identity and `setAppUserModelId` (notifications, taskbar). */
  appId: 'com.seazone.doneldev.server',
  /** Start of the installer file name, in the release and in its `latest.yml`. */
  installerPrefix: 'DonelDevServer-Setup-',
} as const;

/** The part of electron-updater's `UpdateInfo` the guard reads. */
export interface UpdateFilesInfo {
  readonly files?: readonly { readonly url?: unknown }[];
}

/**
 * The Server's releases are GitHub prereleases of the same repo as the Alfa's (tag `server-*`), so the Alfa, which
 * reads only the "Latest" release, never sees them. The Server reads the newest prerelease; if the feed ever hands it
 * something else (an Alfa release), this guard turns it into "no update" instead of installing the Alfa over it.
 */
export function isOwnUpdate(info: UpdateFilesInfo | null | undefined): boolean {
  const files = info?.files;
  if (!Array.isArray(files) || files.length === 0) return false;
  return files.every((file) => typeof file?.url === 'string' && file.url.startsWith(APP_IDENTITY.installerPrefix));
}
