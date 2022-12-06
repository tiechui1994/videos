package ws

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/ion-log"
)

type WebSocketServer struct {
	WebSocketConfig
	upgrader *websocket.Upgrader

	broadcast  chan *broadcastData
	register   chan *Conn
	unregister chan *Conn
	nodes      sync.Map
	fd         *os.File
}

type broadcastData struct {
	data []byte
}

func NewWebSocketServer() *WebSocketServer {
	instance := &WebSocketServer{
		upgrader: &websocket.Upgrader{
			HandshakeTimeout: time.Second,
		},
		broadcast:  make(chan *broadcastData),
		register:   make(chan *Conn),
		unregister: make(chan *Conn),
		nodes:      sync.Map{},
	}

	return instance
}

func (w *WebSocketServer) Upgrade(writer http.ResponseWriter, request *http.Request, header http.Header) {
	var err error
	defer func() {
		if err != nil {
			io.WriteString(writer, err.Error())
		}
	}()

	var raw *websocket.Conn
	raw, err = w.upgrader.Upgrade(writer, request, header)
	if err != nil {
		return
	}

	master := request.URL.Query().Get("master")
	if master == "" {
		err = fmt.Errorf("invalid master")
		return
	}
	slave := request.URL.Query().Get("slave")
	if slave == "" {
		err = fmt.Errorf("invalid slave")
		return
	}

	if master == slave {
		log.Infof("add new master: %v", master)
		node := newNode(raw, w.PingPeriod, uint(w.PingTimeout), w.MessageType)
		w.nodes.Store(master, node)
		return
	}

	if val, ok := w.nodes.Load(master); ok {
		log.Infof("add new slave: %v", slave)
		val.(Node).AddSlave(raw)
		return
	}

	err = fmt.Errorf("invalid params")
}

func (w *WebSocketServer) ServerFile(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		return
	}

	ranges := request.Header.Get("range")
	if len(ranges) > 0 {
		parts := strings.Split(strings.ReplaceAll(ranges, "bytes=", ""), "-")
		start, _ := strconv.ParseInt(parts[0], 1, 64)
		end, _ := strconv.ParseInt(parts[1], 1, 64)
		if end == 0 {
			end = 512
		}

		writer.Header().Set("Content-Range", fmt.Sprintf("bytes %v-%v/1000000000000000000000", start, end))
		writer.Header().Set("Accept-Ranges", "bytes")
		writer.Header().Set("Content-Type", "video/webm")
		writer.Header().Set("Content-Length", fmt.Sprintf("%v", end-start+1))
		writer.WriteHeader(206)

		data := make([]byte, end-start+1)
		n, err := w.fd.ReadAt(data, start)
		log.Infof("err: %v, %v", err, n)
		writer.Write(data)
	} else {
		writer.Header().Set("Accept-Ranges", "bytes")
		writer.Header().Set("Content-Type", "video/webm")
		writer.WriteHeader(200)
		io.CopyBuffer(writer, w.fd, make([]byte, 4096))
	}
}

func (w *WebSocketServer) Initializer(c *WebSocketConfig) error {
	if c == nil {
		return fmt.Errorf("config cna not be nil")
	}

	config := *c
	config.SetDefault()
	err := config.Valid()
	if err != nil {
		return err
	}

	w.WebSocketConfig = config
	w.upgrader.HandshakeTimeout = config.HandshakeTimeout
	w.upgrader.ReadBufferSize = config.ReadBufferSize
	w.upgrader.WriteBufferSize = config.WriteBufferSize
	w.upgrader.CheckOrigin = func(r *http.Request) bool {
		return checkOrigin(r.Header.Get("origin"), w.AllowOrigins)
	}

	return nil
}

func checkOrigin(origin string, allowOrigins []string) bool {
	if len(allowOrigins) == 1 && allowOrigins[0] == "*" {
		return true
	}
	for _, o := range allowOrigins {
		if o == origin {
			return true
		}
	}
	return false
}
