import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';

// Unsupported operations remain permanently unavailable in this fixed driver.
export class PrivateNativeStockStorageDenials {
  async downloadFolder(): Promise<void> {
    throw new PrivateNativeActionUnavailable();
  }
  async uploadFolder(): Promise<void> {
    throw new PrivateNativeActionUnavailable();
  }
  async downloadFile(): Promise<void> {
    throw new PrivateNativeActionUnavailable();
  }
  async delete(): Promise<void> {
    throw new PrivateNativeActionUnavailable();
  }
  async move(): Promise<void> {
    throw new PrivateNativeActionUnavailable();
  }
  async copy(): Promise<void> {
    throw new PrivateNativeActionUnavailable();
  }
  async getPresignedUrl(): Promise<string | null> {
    throw new PrivateNativeActionUnavailable();
  }
}
