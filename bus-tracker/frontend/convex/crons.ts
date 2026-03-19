import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

const crons = cronJobs();

// Получаем новые позиции автобусов каждые 15 секунд (быстрее и надежнее, чем Socket.io)
crons.interval(
  "fetch-bus-data",
  { seconds: 15 }, 
  api.ingest.pollBusData
);

// Не даем Render заснуть (бесплатный 24/7 хостинг)
crons.interval(
  "keep-render-awake",
  { minutes: 10 },
  api.ingest.pingRender
);

export default crons;
