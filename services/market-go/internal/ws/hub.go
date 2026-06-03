package ws

import "sync"

type Client interface {
	Send([]byte) bool
	Close()
}

type Hub struct {
	mu      sync.RWMutex
	clients map[Client]struct{}
}

func NewHub() *Hub {
	return &Hub{clients: make(map[Client]struct{})}
}

func (h *Hub) Register(client Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[client] = struct{}{}
}

func (h *Hub) Unregister(client Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.clients[client]; ok {
		delete(h.clients, client)
		client.Close()
	}
}

func (h *Hub) Broadcast(message []byte) {
	h.mu.RLock()
	clients := make([]Client, 0, len(h.clients))
	for client := range h.clients {
		clients = append(clients, client)
	}
	h.mu.RUnlock()

	for _, client := range clients {
		if !client.Send(message) {
			h.Unregister(client)
		}
	}
}

func (h *Hub) Count() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}
