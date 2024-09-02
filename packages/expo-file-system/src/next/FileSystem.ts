import ExpoFileSystem from './ExpoFileSystem';
import { Path } from './FileSystem.types';

export class File extends ExpoFileSystem.FileSystemFile {
  constructor(path: Path) {
    super(path);
    this.validatePath();
  }
}

// Cannot use `static` keyword in class declaration because of a runtime error.
File.downloadFileAsync = async function downloadFileAsync(url: string, to: File | Directory) {
  const outputPath = await ExpoFileSystem.downloadFileAsync(url, to);
  return new File(outputPath);
};

export class Directory extends ExpoFileSystem.FileSystemDirectory {
  constructor(path: Path) {
    super(path);
    this.validatePath();
  }

  list() {
    // We need to wrap it in the JS File/Directory classes, and returning SharedObjects in lists is not supported yet on Android.
    return super
      .listAsRecords()
      .map(({ isDirectory, path }) => (isDirectory ? new Directory(path) : new File(path)));
  }
}

// consider module functions as API alternative
export async function write(file: File, contents: string) {
  return file.write(contents);
}
