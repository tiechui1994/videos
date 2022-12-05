package main

import (
	"net/http"

	"github.com/video/ws"
)

func main() {
	webSocket := ws.NewWebSocketServer()
	_ = webSocket.Initializer(&ws.WebSocketConfig{
		MessageType: ws.BinaryMessage,
	})

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", func(writer http.ResponseWriter, request *http.Request) {
		webSocket.Upgrade(writer, request, http.Header{})
	})
	mux.HandleFunc("/file", func(writer http.ResponseWriter, request *http.Request) {
		webSocket.ServerFile(writer, request)
	})

	server := http.Server{
		Addr:    ":8088",
		Handler: mux,
	}

	_ = server.ListenAndServe()
}
