import { type Repository } from 'typeorm';

import { type UserEntity } from 'src/engine/core-modules/user/user.entity';
import { type CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';

// The final native deletion/cache operation. Membership removal remains the
// caller's stock operation; private setup must independently prove it absent.
export class StockUserSoftDeletionService {
  constructor(
    private readonly userRepository: Pick<
      Repository<UserEntity>,
      'softDelete' | 'findOne'
    >,
    private readonly coreEntityCacheService: Pick<
      CoreEntityCacheService,
      'invalidate'
    >,
  ) {}

  async softDeleteUser(userId: string) {
    await this.userRepository.softDelete({ id: userId });
    await this.coreEntityCacheService.invalidate('user', userId);

    return await this.userRepository.findOne({
      where: {
        id: userId,
      },
      withDeleted: true,
    });
  }
}
