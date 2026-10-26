import { RemoteMediaFrameController } from "../../src/Render/Video/RemoteMediaFrameController";

const button = document.querySelector<HTMLButtonElement>("#start")!;
const result = document.querySelector<HTMLPreElement>("#result")!;

button.onclick = async () => {
  button.disabled = true;
  const capture = new RemoteMediaFrameController();
  const audio = new AudioContext();
  const destination = audio.createMediaStreamDestination();
  const oscillator = audio.createOscillator();
  oscillator.frequency.value = 440;
  oscillator.connect(destination);
  oscillator.start();
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext("2d")!;
  const stream = canvas.captureStream(30);
  const video = stream.getVideoTracks()[0]!;
  const audioTrack = destination.stream.getAudioTracks()[0]!;
  let tick = 0;
  const paint = setInterval(() => {
    context.fillStyle = `hsl(${tick++ % 360} 70% 50%)`;
    context.fillRect(0, 0, 320, 180);
  }, 33);
  const counts = { video: 0, audio: 0, nonzeroAudio: false, sameStream: true, closedVideoFrames: 0 };
  let identity: string | undefined;
  const first: Record<string, number> = {};
  const last: Record<string, number> = {};
  try {
    const resumed = audio.resume();
    const observing = capture.setListener(packet => {
      identity ??= packet.streamID;
      counts.sameStream &&= identity === packet.streamID;
      const type = packet.content.type;
      first[type] ??= packet.presentationTimeStamp;
      last[type] = packet.presentationTimeStamp;
      if (packet.content.type === "video") {
        counts.video++;
        packet.content.frame.frame.close();
        counts.closedVideoFrames++;
      } else {
        counts.audio++;
        counts.nonzeroAudio ||= packet.content.frame.data.some(byte => byte !== 0);
      }
    });
    await Promise.all([resumed, observing]);
    capture.setSource({ bindingID: "synthetic", userID: "bot", videoTrack: video, audioTrack });
    result.textContent = "Observing synthetic raw audio/video…";
    await new Promise(resolve => setTimeout(resolve, 2500));
    await capture.setListener(undefined);
    const stoppedCounts = JSON.stringify(counts);
    await new Promise(resolve => setTimeout(resolve, 100));
    const pass = counts.video >= 20 && counts.audio >= 50 && counts.nonzeroAudio && counts.sameStream &&
      counts.video === counts.closedVideoFrames && JSON.stringify(counts) === stoppedCounts &&
      video.readyState === "live" && audioTrack.readyState === "live";
    result.textContent = JSON.stringify({ pass, ...counts, first, last,
      startOffsetUs: first.video! - first.audio!,
      tracksPreserved: video.readyState === "live" && audioTrack.readyState === "live" }, null, 2);
  } catch (error) {
    result.textContent = `FAILED: ${String(error)}`;
  } finally {
    await capture.setListener(undefined);
    clearInterval(paint);
    oscillator.stop();
    for (const track of [...stream.getTracks(), ...destination.stream.getTracks()]) track.stop();
    await audio.close();
    button.disabled = false;
  }
};
