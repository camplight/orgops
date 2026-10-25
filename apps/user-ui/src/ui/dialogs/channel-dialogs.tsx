import type { Agent, Channel } from "../../types";
import type { useStartConversation } from "../conversations/use-start-conversation";
import type { useConversationAgentSelection } from "../conversations/use-conversation-agent-selection";
import type { useParticipants } from "../conversations/use-participants";
import type { useShares } from "../conversations/use-shares";
import type { useShareLink } from "../conversations/use-share-link";
import type { useChannelManagement } from "../conversations/use-channel-management";
import { ConversationDialog } from "./conversation-dialog";
import { ParticipantsDialog } from "./participants-dialog";
import { ChannelManageDialog } from "./channel-manage-dialog";

type ChannelDialogsProps = {
  showConversationDialog: boolean;
  showParticipantsDialog: boolean;
  showChannelManageDialog: boolean;
  setShowConversationDialog: (value: boolean) => void;
  setShowParticipantsDialog: (value: boolean) => void;
  setShowChannelManageDialog: (value: boolean) => void;
  activeChannel: Channel | null;
  activeChannelManageable: boolean;
  loading: boolean;
  canStartConversation: boolean;
  visibleAgents: Agent[];
  humans: Array<{ username: string }>;
  conversation: ReturnType<typeof useStartConversation>;
  agentSelection: ReturnType<typeof useConversationAgentSelection>;
  participants: ReturnType<typeof useParticipants>;
  shares: ReturnType<typeof useShares>;
  shareLink: ReturnType<typeof useShareLink>;
  channelManagement: ReturnType<typeof useChannelManagement>;
};

export function ChannelDialogs({
  showConversationDialog,
  showParticipantsDialog,
  showChannelManageDialog,
  setShowConversationDialog,
  setShowParticipantsDialog,
  setShowChannelManageDialog,
  activeChannel,
  activeChannelManageable,
  loading,
  canStartConversation,
  visibleAgents,
  humans,
  conversation,
  agentSelection,
  participants,
  shares,
  shareLink,
  channelManagement
}: ChannelDialogsProps) {
  const {
    conversationName,
    conversationDescription,
    conversationVisibility,
    setConversationName,
    setConversationDescription,
    setConversationVisibility,
    handleStartConversation
  } = conversation;
  const {
    setAgentSearchQuery,
    agentSearchQuery,
    selectedConversationAgentRecords,
    agentSuggestions,
    addConversationAgent,
    removeConversationAgent
  } = agentSelection;
  const {
    participantKind,
    participantValue,
    participantSubmitting,
    participantRemovingKey,
    setParticipantKind,
    setParticipantValue,
    handleAddParticipant,
    handleRemoveParticipant
  } = participants;
  const {
    shareKind,
    shareValue,
    shareSubmitting,
    shareRemovingKey,
    setShareKind,
    setShareValue,
    handleAddShare,
    handleRemoveShare
  } = shares;
  const { shareLinkCopied, handleCopyShareLink } = shareLink;
  const {
    channelVisibilityDraft,
    archiveDraft,
    updatingChannelVisibility,
    setChannelVisibilityDraft,
    setArchiveDraft,
    handleDeleteChannel,
    handleSaveChannelSettings
  } = channelManagement;

  return (
    <>
      {showConversationDialog ? (
        <ConversationDialog
          name={conversationName}
          description={conversationDescription}
          visibility={conversationVisibility}
          selectedAgents={selectedConversationAgentRecords}
          agentSearchQuery={agentSearchQuery}
          visibleAgents={visibleAgents}
          agentSuggestions={agentSuggestions}
          loading={loading}
          canStart={canStartConversation}
          onClose={() => setShowConversationDialog(false)}
          onSubmit={handleStartConversation}
          onNameChange={setConversationName}
          onDescriptionChange={setConversationDescription}
          onVisibilityChange={setConversationVisibility}
          onRemoveAgent={removeConversationAgent}
          onAddAgent={addConversationAgent}
          onAgentSearchQueryChange={setAgentSearchQuery}
        />
      ) : null}

      {showParticipantsDialog && activeChannel && activeChannelManageable ? (
        <ParticipantsDialog
          channel={activeChannel}
          visibleAgents={visibleAgents}
          humans={humans}
          participantKind={participantKind}
          participantValue={participantValue}
          participantSubmitting={participantSubmitting}
          participantRemovingKey={participantRemovingKey}
          shareKind={shareKind}
          shareValue={shareValue}
          shareSubmitting={shareSubmitting}
          shareRemovingKey={shareRemovingKey}
          onClose={() => setShowParticipantsDialog(false)}
          onParticipantKindChange={setParticipantKind}
          onParticipantValueChange={setParticipantValue}
          onAddParticipant={handleAddParticipant}
          onRemoveParticipant={(participant) => void handleRemoveParticipant(participant)}
          onShareKindChange={setShareKind}
          onShareValueChange={setShareValue}
          onAddShare={handleAddShare}
          onRemoveShare={(share) => void handleRemoveShare(share)}
        />
      ) : null}

      {showChannelManageDialog && activeChannel && activeChannelManageable ? (
        <ChannelManageDialog
          channel={activeChannel}
          underlay={showParticipantsDialog}
          visibilityDraft={channelVisibilityDraft}
          archiveDraft={archiveDraft}
          updating={updatingChannelVisibility}
          shareLinkCopied={shareLinkCopied}
          onClose={() => setShowChannelManageDialog(false)}
          onVisibilityDraftChange={setChannelVisibilityDraft}
          onArchiveDraftChange={setArchiveDraft}
          onManageParticipants={() => {
            setShowParticipantsDialog(true);
          }}
          onCopyShareLink={() => void handleCopyShareLink()}
          onSave={() => void handleSaveChannelSettings()}
          onDelete={(channel) => void handleDeleteChannel(channel)}
        />
      ) : null}
    </>
  );
}
