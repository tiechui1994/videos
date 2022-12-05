package ws

import (
	"fmt"
	"time"

	"github.com/gorilla/websocket"
)

var (
	ErrTimeout = fmt.Errorf("ping timeout")
)

type MessageType = int

const (
	TextMessage   MessageType = websocket.TextMessage
	BinaryMessage MessageType = websocket.BinaryMessage
)

type WebSocketConfig struct {
	// websocket配置
	// 读超时
	ReadDeadline time.Duration `json:"readdeadline"`
	// 写超时
	WriteDeadline time.Duration `json:"writedeadline"`
	// 发送ping间隔
	PingPeriod time.Duration `json:"pingperiod"`
	// SetReadLimit sets the maximum size in bytes for a message read from the peer. If a message exceeds the limit, the connection sends a close message to the peer and returns ErrReadLimit to the application.
	ReadLimit int64 `json:"readlimit"`
	// 握手超时时间
	HandshakeTimeout time.Duration `json:"handshaketimeout"`
	// 允许跨域origins
	AllowOrigins []string `json:"alloworigins"`
	// ReadBufferSize and WriteBufferSize specify I/O buffer sizes in bytes. If a buffer
	// size is zero, then a useful default size is used. The I/O buffer sizes
	// do not limit the size of the messages that can be sent or received.
	ReadBufferSize  int `json:"readbuffersize"`
	WriteBufferSize int `json:"writebuffersize"`

	// LinksLimit WebSocket client link num limit
	LinksLimit int `json:"linkslimit"`

	// PingTimeout WebSocket timeout with times of PingPeriod
	PingTimeout int `json:"pingtimeout"`

	// MessageType WebSocket Message Type
	MessageType MessageType `json:"messagetype"`
}

func (config *WebSocketConfig) SetDefault() {
	if len(config.AllowOrigins) == 0 {
		config.AllowOrigins = []string{"*"}
	}
	if config.PingPeriod == 0 {
		config.PingPeriod = 1 * time.Second
	}
	if config.ReadDeadline == 0 {
		config.ReadDeadline = 1 * time.Second
	}
	if config.WriteDeadline == 0 {
		config.WriteDeadline = 1 * time.Second
	}
	if config.HandshakeTimeout == 0 {
		config.HandshakeTimeout = 10 * time.Second
	}
	if config.ReadBufferSize == 0 {
		config.ReadBufferSize = 2048
	}
	if config.WriteBufferSize == 0 {
		config.WriteBufferSize = 2048
	}
	if config.LinksLimit <= 0 {
		config.LinksLimit = 2048
	}
	if config.PingTimeout <= 0 || config.PingTimeout > 10 {
		config.PingTimeout = 3
	}
	if config.MessageType <= 0 {
		config.MessageType = TextMessage
	}
}

func (config *WebSocketConfig) Valid() error {
	if config.MessageType != BinaryMessage && config.MessageType != TextMessage {
		return fmt.Errorf("invalid MessageType: %v", config.MessageType)
	}

	return nil
}
