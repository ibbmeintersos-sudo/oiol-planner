# Order monolith fixture

Order creation is synchronous and directly calls an email notification module. There is no queue, retry policy, idempotency key, or notification delivery record.
