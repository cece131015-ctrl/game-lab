// Valores fisicos de Rocket League.
// Fuente principal: RocketSim (https://github.com/ZealanL/RocketSim, licencia MIT, (c) 2022 ZealanL)
// y la wiki de RLBot ("Useful game values"). Todas las distancias en Unreal Units (1 uu = 1 cm).

export const TICK_RATE = 120;
export const DT = 1 / TICK_RATE;

export const GRAVITY_Z = -650;

// Arena (estadio estandar de futbol)
export const ARENA_EXTENT_X = 4096;
export const ARENA_EXTENT_Y = 5120;
export const ARENA_HEIGHT = 2044;
export const ARENA_CORNER_SUM = 8064; // |x| + |y| del muro diagonal de las esquinas
export const ARENA_PLAN_ROUND = 300; // radio del redondeo entre muros (vista en planta)
export const ARENA_EDGE_ROUND = 300; // radio de la curva suelo/muro y muro/techo

export const GOAL_HALF_WIDTH = 892.755;
export const GOAL_HEIGHT = 642.775;
export const GOAL_DEPTH = 880;
export const GOAL_BACK_Y = ARENA_EXTENT_Y + GOAL_DEPTH;
export const GOAL_SCORE_Y = 5124.25; // + radio del balon

// Masas (unidades de Bullet)
export const CAR_MASS = 180;
export const BALL_MASS = CAR_MASS / 6;

// Balon
export const BALL_RADIUS = 91.25;
export const BALL_REST_Z = 93.15;
export const BALL_MAX_SPEED = 6000;
export const BALL_MAX_ANG_SPEED = 6;
export const BALL_DRAG = 0.03;
// Modelo de rebote del balon (Chip, "Rocket League ball physics")
export const BALL_BOUNCE_RESTITUTION = 0.6;
export const BALL_BOUNCE_MU = 0.285;
export const BALL_BOUNCE_SPIN_A = 0.0003;
export const BALL_BOUNCE_Y = 2.0;

// Coche
export const CAR_MAX_SPEED = 2300;
export const CAR_MAX_ANG_SPEED = 5.5;
export const SUPERSONIC_START_SPEED = 2200;
export const SUPERSONIC_MAINTAIN_MIN_SPEED = 2100;
export const SUPERSONIC_MAINTAIN_MAX_TIME = 1;

export const BOOST_MAX = 100;
export const BOOST_USED_PER_SECOND = BOOST_MAX / 3;
export const BOOST_MIN_TIME = 0.1;
export const BOOST_ACCEL_GROUND = 2975 / 3;
export const BOOST_ACCEL_AIR = 3175 / 3;
export const BOOST_SPAWN_AMOUNT = BOOST_MAX / 3;

export const POWERSLIDE_RISE_RATE = 5;
export const POWERSLIDE_FALL_RATE = 2;

export const THROTTLE_ACCEL = 1600; // 4 ruedas x 400
export const BRAKE_ACCEL = 3500;
export const COASTING_BRAKE_FACTOR = 0.15;
export const STOPPING_FORWARD_VEL = 25;
export const THROTTLE_DEADZONE = 0.001;
export const THROTTLE_AIR_ACCEL = 200 / 3;

export const JUMP_ACCEL = 4375 / 3;
export const JUMP_IMMEDIATE_FORCE = 875 / 3;
export const JUMP_MIN_TIME = 0.025;
export const JUMP_RESET_TIME_PAD = 1 / 40;
export const JUMP_MAX_TIME = 0.2;
export const JUMP_PRE_MIN_ACCEL_SCALE = 0.62;
export const DOUBLEJUMP_MAX_DELAY = 1.25;

export const FLIP_Z_DAMP_120 = 0.35;
export const FLIP_Z_DAMP_START = 0.15;
export const FLIP_Z_DAMP_END = 0.21;
export const FLIP_TORQUE_TIME = 0.65;
export const FLIP_PITCHLOCK_EXTRA_TIME = 0.3;
export const FLIP_INITIAL_VEL_SCALE = 500;
export const FLIP_TORQUE_X = 260; // roll (izq/der)
export const FLIP_TORQUE_Y = 224; // pitch (adelante/atras)
export const FLIP_FORWARD_IMPULSE_MAX_SPEED_SCALE = 1;
export const FLIP_SIDE_IMPULSE_MAX_SPEED_SCALE = 1.9;
export const FLIP_BACKWARD_IMPULSE_MAX_SPEED_SCALE = 2.5;
export const FLIP_BACKWARD_IMPULSE_SCALE_X = 16 / 15;
export const DODGE_DEADZONE = 0.5;

export const CAR_TORQUE_SCALE = (2 * Math.PI / 65536) * 1000;
// Control aereo (pitch, yaw, roll)
export const AIR_TORQUE = [130, 95, 400];
export const AIR_DAMPING = [30, 20, 50];

export const CAR_AUTOFLIP_IMPULSE = 200;
export const CAR_AUTOFLIP_TORQUE = 50;
export const CAR_AUTOFLIP_TIME = 0.4;
export const CAR_AUTOFLIP_NORMZ_THRESH = Math.SQRT1_2;
export const CAR_AUTOFLIP_ROLL_THRESH = 2.8;
export const CAR_AUTOROLL_FORCE = 100;
export const CAR_AUTOROLL_TORQUE = 80;

// Suspension (btRaycastVehicle de RocketSim convertido a aceleraciones por uu)
export const SUSPENSION_STIFFNESS = 500;
export const WHEELS_DAMPING_COMPRESSION = 25;
export const WHEELS_DAMPING_RELAXATION = 40;
export const MAX_SUSPENSION_TRAVEL = 12;
export const SUSPENSION_FORCE_SCALE_FRONT = 36 - 1 / 4;
export const SUSPENSION_FORCE_SCALE_BACK = 54 + 1 / 4 + 1.5 / 100;

// Colisiones
export const CARWORLD_FRICTION = 0.3;
export const CARWORLD_RESTITUTION = 0.3;
export const CARBALL_FRICTION = 2.0;
export const CARBALL_RESTITUTION = 0.0;
export const CARCAR_FRICTION = 0.09;
export const CARCAR_RESTITUTION = 0.1;

export const BALL_CAR_EXTRA_IMPULSE_Z_SCALE = 0.35;
export const BALL_CAR_EXTRA_IMPULSE_FORWARD_SCALE = 0.65;
export const BALL_CAR_EXTRA_IMPULSE_MAXDELTAVEL = 4600;

export const BUMP_COOLDOWN_TIME = 0.25;
export const BUMP_MIN_FORWARD_DIST = 64.5;
export const DEMO_RESPAWN_TIME = 3;

export const CAR_SPAWN_REST_Z = 17;
export const CAR_RESPAWN_Z = 36;

// Curvas por tramos [entrada, salida]
export const STEER_ANGLE_FROM_SPEED = [[0, 0.53356], [500, 0.3193], [1000, 0.18203], [1500, 0.1057], [1750, 0.08507], [3000, 0.03454]];
export const POWERSLIDE_STEER_ANGLE_FROM_SPEED = [[0, 0.39235], [2500, 0.1261]];
export const DRIVE_SPEED_TORQUE_FACTOR = [[0, 1], [1400, 0.1], [1410, 0]];
export const NON_STICKY_FRICTION_FACTOR = [[0, 0.1], [0.7075, 0.5], [1, 1]];
export const LAT_FRICTION = [[0, 1], [1, 0.2]];
export const HANDBRAKE_LAT_FRICTION_FACTOR = 0.1;
export const HANDBRAKE_LONG_FRICTION_FACTOR = [[0, 0.5], [1, 0.9]];
export const BALL_CAR_EXTRA_IMPULSE_FACTOR = [[0, 0.65], [500, 0.65], [2300, 0.55], [4600, 0.3]];
export const BUMP_VEL_AMOUNT_GROUND = [[0, 5 / 6], [1400, 1100], [2200, 1530]];
export const BUMP_VEL_AMOUNT_AIR = [[0, 5 / 6], [1400, 1390], [2200, 1945]];
export const BUMP_UPWARD_VEL_AMOUNT = [[0, 2 / 6], [1400, 278], [2200, 417]];

export function curve(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
    }
  }
  return points[points.length - 1][1];
}

// Pads de turbo
export const BOOST_PAD = {
  bigRadius: 208,
  smallRadius: 144,
  height: 95,
  bigCooldown: 10,
  smallCooldown: 4,
  bigAmount: 100,
  smallAmount: 12,
};

export const BOOST_PADS_SMALL = [
  [0, -4240], [-1792, -4184], [1792, -4184], [-940, -3308], [940, -3308], [0, -2816],
  [-3584, -2484], [3584, -2484], [-1788, -2300], [1788, -2300], [-2048, -1036], [0, -1024],
  [2048, -1036], [-1024, 0], [1024, 0], [-2048, 1036], [0, 1024], [2048, 1036],
  [-1788, 2300], [1788, 2300], [-3584, 2484], [3584, 2484], [0, 2816], [-940, 3308],
  [940, 3308], [-1792, 4184], [1792, 4184], [0, 4240],
];
export const BOOST_PADS_BIG = [
  [-3584, 0], [3584, 0], [-3072, 4096], [3072, 4096], [-3072, -4096], [3072, -4096],
];

// Posiciones de saque (equipo azul; el naranja es la reflexion en el origen)
export const KICKOFF_SPAWNS = [
  { x: -2048, y: -2560, yaw: Math.PI / 4 },
  { x: 2048, y: -2560, yaw: (3 * Math.PI) / 4 },
  { x: -256, y: -3840, yaw: Math.PI / 2 },
  { x: 256, y: -3840, yaw: Math.PI / 2 },
  { x: 0, y: -4608, yaw: Math.PI / 2 },
];
export const RESPAWN_SPOTS = [
  { x: -2304, y: -4608, yaw: Math.PI / 2 },
  { x: -2688, y: -4608, yaw: Math.PI / 2 },
  { x: 2304, y: -4608, yaw: Math.PI / 2 },
  { x: 2688, y: -4608, yaw: Math.PI / 2 },
];

export const TEAM_BLUE = 0;
export const TEAM_ORANGE = 1;

export const MATCH_TIME = 300; // 5 minutos
export const KICKOFF_COUNTDOWN = 3;
export const GOAL_CELEBRATION_TIME = 3;
