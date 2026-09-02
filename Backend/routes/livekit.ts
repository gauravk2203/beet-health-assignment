import { randomUUID } from "node:crypto";
import { Router } from "express";
import { AccessToken } from "livekit-server-sdk";
import { RoomAgentDispatch, RoomConfiguration } from "@livekit/protocol";
import { HttpError } from "../errors.js";

const AGENT_NAME = "meal-logger";
const livekitRouter = Router();

livekitRouter.post("/token", async (req, res, next) => {
  try {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const serverUrl = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !serverUrl) {
      throw new HttpError(500, "LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET must be set");
    }

    const body = (req.body ?? {}) as {
      room_name?: string;
      participant_identity?: string;
      participant_name?: string;
    };

    const roomName = body.room_name || `meal-${randomUUID()}`;
    const identity = body.participant_identity || `user-${randomUUID()}`;

    const token = new AccessToken(apiKey, apiSecret, {
      identity,
      name: body.participant_name || "user",
      ttl: "15m",
    });
    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    token.roomConfig = new RoomConfiguration({
      agents: [new RoomAgentDispatch({ agentName: AGENT_NAME })],
    });

    res.json({
      serverUrl,
      participantToken: await token.toJwt(),
      roomName,
    });
  } catch (error) {
    next(error);
  }
});

export default livekitRouter;
