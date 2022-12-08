package ws

import (
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/ion-log"
)

type Node interface {
	AddSlave(c *websocket.Conn)
	Close()
}

type Session struct {
	fd     *os.File
	master *Conn
	slave  sync.Map
	params struct {
		pingPeriod time.Duration
		maxPing    uint
		msgType    MessageType
	}
}

func newNode(conn *websocket.Conn, pingPeriod time.Duration, maxPing uint, msgType MessageType) Node {
	master := newConn(conn, pingPeriod, maxPing, msgType)
	s := &Session{master: master}
	s.params.msgType = msgType
	s.params.maxPing = maxPing
	s.params.pingPeriod = pingPeriod
	master.OnData(s.BroadCast)
	master.OnDisconnect(func(conn *Conn, err error) {
		s.master.Close()
	})

	filename := fmt.Sprintf("/tmp/master_%v.webm", strings.ReplaceAll(conn.RemoteAddr().String(), ":", "_"))
	s.fd, _ = os.OpenFile(filename, os.O_RDWR|os.O_TRUNC|os.O_CREATE|os.O_APPEND, 0666)
	return s
}

func (s *Session) BroadCast(message Message) {
	s.fd.Write(message.Data)
	s.slave.Range(func(key, value interface{}) bool {
		log.Infof("forward len: %v", len(message.Data))
		c := value.(*Conn)
		c.Write(message.Data)
		return false
	})
}

func (s *Session) AddSlave(conn *websocket.Conn) {
	slave := newConn(conn, s.params.pingPeriod, s.params.maxPing, s.params.msgType)
	slave.OnDisconnect(func(conn *Conn, err error) {
		s.slave.Delete(slave.RemoteAddr())
	})
	s.slave.LoadOrStore(slave.RemoteAddr(), slave)
}

func (s *Session) Close() {
	s.slave.Range(func(key, value interface{}) bool {
		c := value.(*Conn)
		c.Close()
		return false
	})

	if s.master != nil {
		s.master.Close()
	}

	if s.fd != nil {
		s.fd.Close()
	}
}
