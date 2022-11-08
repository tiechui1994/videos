const DeviceKind = {
    AUDIOINPUT: 'audioinput',
    AUDIOOUTPUT: 'audiooutput',
    VIDEOINPUT: 'videoinput'
};

function log(...args) {
    console.log(...args)
}

async function getDevices(kind) {
    const device = [];
    await navigator.mediaDevices.enumerateDevices().then(function (mediaDevices) {
        mediaDevices.forEach((v) => {
            const label = v.label.toLocaleLowerCase();
            if (v.kind === kind && !(label.includes('virtual') || label.includes('虚拟'))) {
                log(v);
                device.push(v);
            }
        });
    }).catch(function (err) {
        log(err.name + ': ' + err.message);
    });
    return device;
}

function captureUserMedia(kind, success_callback) {
    getDevices().then((device) => {
        if (device.length > 0) {
            const session = {
                audio: {
                    groupId: device[0].groupId,
                },
                video: {
                    width: 3840,
                    height: 2160,
                    frameRate: 60
                }
            };
            navigator.mediaDevices.getUserMedia(session).then(success_callback).catch((error) => {
                alert('Unable to capture your camera. Please check console logs.');
                console.error(error);
            });
        }
    });
}

function captureDisplayMedia(kind, success_callback) {
    getDevices(kind).then((device) => {
        if (!device.length) {
            alert('没有合适的输入设备, 请检查后再试....');
            return
        }

        const videoConstraints = {
            video: {
                width: 2560,
                height: 1440,
                frameRate: 30
            }
        };
        console.log('video', videoConstraints)
        navigator.mediaDevices.getDisplayMedia(videoConstraints).then((videoStream) => {
            const [videoTrack] = videoStream.getVideoTracks()
            const audioConstraints = {
                audio: {
                    groupId: device[0].groupId,
                    autoGainControl: true, // 自动增益
                    echoCancellation: true, // 回声消除
                    noiseSuppression: true, // 噪音抑制
                },
            };
            console.log('audio', audioConstraints)
            navigator.mediaDevices.getUserMedia(audioConstraints).then((audioStream) => {
                const [audioTrack] = audioStream.getAudioTracks()
                console.log(videoTrack, audioTrack)
                const stream = new MediaStream([videoTrack, audioTrack])

                videoTrack.onended = () => {
                    videoStream.stop()
                    audioStream.stop()
                    stream.stop()
                    log("videoTrack and audioTrack stop")
                    log("videoTrack Stop ..............")
                }
                audioTrack.onended = () => {
                    log("audioTrack Stop ..............")
                }
                success_callback(stream)
            })
        }).catch((err) => {
            alert('无法获取到共享桌面, 请检查后再试....');
            console.error(err);
        });
    })
}

function Transport(url, onmessage) {
    const self = this;
    let socket = null
    let closed = false;
    let connected = false;

    self.connect = () => {
        console.log('connect:', url)
        socket = new WebSocket(url)
        socket.onopen = function () {
            connected = true;
            console.log("[onopen], connected websocket");
        };

        socket.onmessage = onmessage
        socket.onclose = (ev) => {
            console.log('[onclose]', ev)
            if (closed) {
                return
            }

            connected = false
            self.connect()
        }

        socket.onerror = (ev) => {
            console.log('[onerror]', ev)
        }
    }

    self.send = (data) => {
        if (!connected) {
            return
        }

        socket.send(data)
    }

    self.connect()

    self.close = () => {
        console.log('close ....')
        if (closed || !connected) {
            closed = true
            return
        }

        closed = true
        socket.close()
    }
}

const vars = {
    transport: null,
    recorder: null,
    video: document.createElement('video'),
    closed: false,
    stream: null,
}

function onstart() {
    const url = "wss://" + window.location.host + '/ws';
    log(url);
    vars.transport = new Transport(url);

    captureDisplayMedia(DeviceKind.AUDIOINPUT, (stream) => {
        vars.video.srcObject = stream;
        vars.video.controls = true;
        vars.video.autoplay = true;
        vars.video.muted = true;

        vars.stream = stream;

        const queue = [];
        const config = {
            mimeType: 'video/webm; codecs=vp9', // vp8, vp9, h264, mkv, opus/vorbis
            audioBitsPerSecond: 256 * 8 * 1024,
            videoBitsPerSecond: 256 * 8 * 1024,
            checkForInactiveTracks: true,
            timeSlice: 500, // concatenate intervals based blobs
            ondataavailable: function (data, type) {
                queue.push(data);
            }
        };

        vars.recorder = new MediaStreamRecorder(stream, config);
        vars.recorder.record();

        log('start ..........');
        const task = setInterval(() => {
            if (queue.length === 0) {
                if (vars.closed) {
                    log('closed .......')
                    clearInterval(task)
                }
                return
            }

            const length = queue.length > 20 ? 20 : queue.length;
            const blob = new Blob(queue.splice(0, length), {type: "video/webm; codecs=vp9"});
            blob.arrayBuffer().then((v) => {
                vars.transport.send(new Uint8Array(v));
            });
        }, 1500);
    });
}

function onpause() {
    if (vars.recorder) {
        vars.recorder.pause()
    }
}

function onresume() {
    if (vars.recorder) {
        vars.recorder.resume()
    }
}

function onstop() {
    if (vars.recorder) {
        vars.recorder.stop(function (blob) {
            vars.video.srcObject = null;
            vars.video.src = URL.createObjectURL(blob);
            vars.video.controls = true;
            vars.video.autoplay = true;
            vars.video.muted = false;
        });

        vars.closed = true
        if (vars.stream) {
            vars.stream.stop()
        }
    }
}

(() => {
    vars.video.width = 1280;
    vars.video.height = 640;

    const div = document.createElement('div');

    const controlBtn = document.createElement('button');
    controlBtn.innerHTML = '暂停录制';
    controlBtn.className = 'btn btn-success btn-lg button';
    controlBtn.setAttribute('data', 'resume')

    controlBtn.onclick = () => {
        switch (controlBtn.getAttribute('data')) {
            case 'resume':
                log('onpause ......')
                controlBtn.innerHTML = '恢复录制';
                controlBtn.setAttribute('data', 'pause')
                onpause()
                break
            case 'pause':
                log('onresume ......')
                controlBtn.innerHTML = '暂停录制';
                controlBtn.setAttribute('data', 'resume')
                onresume()
                break

        }
    }

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '结束';
    closeBtn.className = 'btn btn-success btn-lg button';
    closeBtn.onclick = () => {
        vars.transport.close()
        onstop()
    }

    div.appendChild(controlBtn)
    div.appendChild(closeBtn)

    const container = document.querySelector('#videos');
    container.innerHTML = '';
    container.appendChild(vars.video);
    container.appendChild(div)

    onstart()
})();

