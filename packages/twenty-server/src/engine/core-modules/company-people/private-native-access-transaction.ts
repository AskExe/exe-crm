import { type PrivateNativeAccessSnapshot } from './private-native-activation-correspondence';
import { type PrivatePeopleDeadline } from './private-people-contract';

// Only protected Core composition may implement retained current authority.
export abstract class OwnedCoreNativeAccessTransaction {
  abstract assertCurrent(
    end: PrivatePeopleDeadline,
  ): Promise<PrivateNativeAccessSnapshot>;
  abstract assertHeld(end: PrivatePeopleDeadline): void;
}
