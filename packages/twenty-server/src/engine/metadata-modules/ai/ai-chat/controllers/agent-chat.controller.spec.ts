import { ServiceUnavailableException } from '@nestjs/common';

import type { Response } from 'express';

import { BillingService } from 'src/engine/core-modules/billing/services/billing.service';
import type { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AgentChatController } from 'src/engine/metadata-modules/ai/ai-chat/controllers/agent-chat.controller';
import type { AgentChatStreamingService } from 'src/engine/metadata-modules/ai/ai-chat/services/agent-chat-streaming.service';
import type { AiModelRegistryService } from 'src/engine/metadata-modules/ai/ai-models/services/ai-model-registry.service';

describe('Agent chat installation license', () => {
  const streamAgentChat = jest.fn();
  const billing = new BillingService();
  const controller = new AgentChatController(
    { streamAgentChat } as unknown as AgentChatStreamingService,
    billing,
    {
      getAvailableModels: () => ['model'],
      validateModelAvailability: jest.fn(),
    } as unknown as AiModelRegistryService,
  );
  const call = () =>
    controller.streamAgentChat(
      { threadId: 'thread', messages: [] },
      'user-workspace',
      { id: 'workspace', smartModel: 'model' } as WorkspaceEntity,
      {} as Response,
    );

  afterEach(() => {
    jest.restoreAllMocks();
    streamAgentChat.mockClear();
  });

  it('rejects an inactive installation while upstream billing is disabled', async () => {
    jest.spyOn(billing, 'canBillMeteredProduct').mockResolvedValue(false);
    expect(billing.isBillingEnabled()).toBe(false);
    await expect(call()).rejects.toThrow('Installation license is inactive');
    expect(streamAgentChat).not.toHaveBeenCalled();
  });

  it('preserves authority unavailability without starting a stream', async () => {
    jest
      .spyOn(billing, 'canBillMeteredProduct')
      .mockRejectedValue(new ServiceUnavailableException());
    await expect(call()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(streamAgentChat).not.toHaveBeenCalled();
  });

  it('starts a stream after fresh license authorization', async () => {
    jest.spyOn(billing, 'canBillMeteredProduct').mockResolvedValue(true);
    await call();
    expect(streamAgentChat).toHaveBeenCalledTimes(1);
  });
});
