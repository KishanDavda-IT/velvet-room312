export function enhanceOpusSdp(sdp) {
  if (typeof sdp !== 'string') return sdp;
  return sdp.replaceAll(
    'useinbandfec=1',
    'useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=192000'
  );
}
