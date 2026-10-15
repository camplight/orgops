import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { JsonRenderBlock } from "../../JsonRenderBlock";
import { OrgopsSecretInput } from "../../OrgopsSecretInput";
import { splitJsonRenderMarkdown } from "../../domain/messaging/json-render-markdown";
import { splitSecretInputMarkdown } from "../../domain/messaging/secret-input-markdown";

type MessageMarkdownProps = {
  text: string;
  keyPrefix: string;
  canPost: boolean;
  channelId: string | null;
  username: string;
};

export function MessageMarkdown({ text, keyPrefix, canPost, channelId, username }: MessageMarkdownProps) {
  return (
    <div className="message-markdown">
      {splitJsonRenderMarkdown(text).map((jsonPart, jsonIndex) =>
        jsonPart.kind === "json-render" ? (
          <JsonRenderBlock
            canPost={canPost}
            channelId={channelId}
            key={`${keyPrefix}-json-render-${jsonIndex}`}
            specText={jsonPart.specText}
            username={username}
          />
        ) : (
          splitSecretInputMarkdown(jsonPart.text).map((secretPart, secretIndex) =>
            secretPart.kind === "secret-input" ? (
              <OrgopsSecretInput
                key={`${keyPrefix}-secret-input-${jsonIndex}-${secretIndex}`}
                spec={secretPart.spec}
              />
            ) : (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ node: _node, ...props }) => (
                    <a {...props} target="_blank" rel="noreferrer" />
                  )
                }}
                key={`${keyPrefix}-markdown-${jsonIndex}-${secretIndex}`}
              >
                {secretPart.text}
              </ReactMarkdown>
            )
          )
        )
      )}
    </div>
  );
}
