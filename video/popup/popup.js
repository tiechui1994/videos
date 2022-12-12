window.onload = function () {
    const now = new Date();
    console.log("onload:", now)
    // chrome.runtime.sendMessage({
    //     event: 'click',
    //     data: now,
    // }).then((data) => {
    //     console.log('send data success', data)
    // })

    const cache = new Cache();
    const startButton = document.getElementById('onStart')
    startButton.onclick = () => {
        startButton.setAttribute('disabled', "true")
        onStart(cache)
    }
}

const Event = {
    onstart: 'onstart',
    onpause: 'onpause',
    onresume: 'onresume',
    onend: 'onend',
};

const State = {
    START: 1,
    RECORDING: 2,
    STOP: 3,
};

const sendMessage =  (message) => {
    chrome.runtime.sendMessage({type: 'event', data: message}).then(() => {
        console.log("==================>")
    });
}

const onStart = (cache) => {
    const input = document.getElementById("name")
    input.setAttribute("value", input.value + ".webm")
    input.setAttribute('disabled', "true")

    let global = cache.get(input.value)
    if (!global || global.state === State.STOP) {
        global = {
            state: State.START,
            name: input.value,
            event: Event.onstart,
        }
        cache.set(global.name, global)
    }

    console.log('global', global)
    sendMessage(global)

    const pauseButton = document.getElementById('onPause')
    pauseButton.setAttribute('data', 'resume')
    pauseButton.innerHTML = "暂停录制"

    const stopButton = document.getElementById('onStop')

    pauseButton.onclick = () => {
        global.state = State.RECORDING
        cache.set(global.name, global)
        switch (pauseButton.getAttribute('data')) {
            case 'resume':
                global.event = Event.onpause
                sendMessage(global)
                pauseButton.innerHTML = '恢复录制';
                pauseButton.setAttribute('data', 'pause')
                break
            case 'pause':
                global.event = Event.onresume
                sendMessage(global)
                pauseButton.innerHTML = '暂停录制';
                pauseButton.setAttribute('data', 'resume')
                pauseButton.onresume()
                break
        }
    }

    stopButton.onclick = () => {
        console.log('[onStop]')
        global.event = Event.onend
        sendMessage(global)
        cache.del(global.name)
    }
}

function Cache() {
    this.items = {};
    chrome.storage.local.get(['all'], (items) => {
        if (!items.all) {
            return
        }
        const now = new Date().valueOf();
        for (let [k, v] of Object.entries(items.all)) {
            if (now < v.expiredAt) {
                this.items[k] = v
            }
        }
    })
}

Cache.prototype = {
    set: function (key, value) {
        this.items[key] = {
            data: value,
            expiredAt: new Date().valueOf() + 60 * 60 * 4,
        }
        chrome.storage.local.set({'all': this.items}, () => {
        })
    },
    get: function (key) {
        const now = new Date().valueOf();
        const value = this.items[key];
        if (value && value.expiredAt > now) {
            delete this.items[key]
            chrome.storage.local.set({'all': this.items}, () => {
            })
            return
        }
        if (value) {
            return value.value;
        }
    },
    del: function (key) {
        if (this.items[key]) {
            delete this.items[key]
            chrome.storage.local.set({'all': this.items}, () => {
            })
        }
    }
}