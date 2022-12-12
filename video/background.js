chrome.runtime.onStartup.addListener(() => {
    console.log('[onStartup]')
})

// chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
//     console.log('message', message)
//     console.log('sender', sender)
//     sendResponse({status: 'ok'})
// })

chrome.runtime.onInstalled.addListener(() => {
    console.info("[onInstalled]")
});

chrome.runtime.onConnect.addListener((port) => {
    console.log('[onConnect]', port)
})

