// Thin wrapper around the Socket.io client (loaded as a global by index.html).

const socket = window.io({ transports: ['websocket', 'polling'] });

export const net = {
  socket,
  get id() { return socket.id; },
  emit: (event, data) => socket.emit(event, data),
  on: (event, fn) => socket.on(event, fn),
  off: (event, fn) => socket.off(event, fn),
  /** Emit with an acknowledgement callback, as a Promise. */
  request(event, data, timeoutMs = 6000) {
    return new Promise((resolve) => {
      socket.timeout(timeoutMs).emit(event, data, (err, res) => {
        resolve(err ? { ok: false, error: 'The server did not answer. Is it running?' } : res);
      });
    });
  },
};
