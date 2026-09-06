import { useState, type SyntheticEvent } from "react";

export const AudioAttachmentPlayer = ({
  src,
  label,
  unavailableMessage,
}: {
  src: string;
  label: string;
  unavailableMessage: string;
}) => {
  const [failed, setFailed] = useState(false);

  const handlePlay = (event: SyntheticEvent<HTMLAudioElement>) => {
    const activePlayer = event.currentTarget;
    activePlayer.ownerDocument
      .querySelectorAll<HTMLAudioElement>("audio[data-edgeever-audio-player]")
      .forEach((player) => {
        if (player !== activePlayer) player.pause();
      });
  };

  if (failed) {
    return (
      <span className="flex min-h-10 items-center px-3 text-sm text-slate-500" role="status">
        {unavailableMessage}
      </span>
    );
  }

  return (
    <audio
      className="h-10 w-full"
      controls
      controlsList="nodownload"
      data-edgeever-audio-player
      preload="metadata"
      src={src}
      aria-label={label}
      onError={() => setFailed(true)}
      onPlay={handlePlay}
    />
  );
};
