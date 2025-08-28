const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // Hash passwords
  const adminPassword = await bcrypt.hash('admin123', 12);
  const memberPassword = await bcrypt.hash('member123', 12);

  // Create admin user
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      email: 'admin@panel.local',
      password: adminPassword,
      role: 'ADMIN',
      isActive: true,
    },
  });

  console.log('✅ Admin user created:', admin.username);

  // Create member user
  const member = await prisma.user.upsert({
    where: { username: 'member' },
    update: {},
    create: {
      username: 'member',
      email: 'member@panel.local',
      password: memberPassword,
      role: 'MEMBER',
      isActive: true,
    },
  });

  console.log('✅ Member user created:', member.username);

  // Create demo container untuk member
  const demoContainer = await prisma.container.upsert({
    where: { id: 'demo-container-id' },
    update: {},
    create: {
      id: 'demo-container-id',
      name: 'Demo Node.js Container',
      image: 'node:18-alpine',
      ownerId: member.id,
      status: 'STOPPED',
      config: {
        workingDir: '/app',
        cmd: ['node', 'index.js'],
        exposedPorts: { '3000/tcp': {} },
      },
      resources: {
        memory: '512m',
        cpus: '0.5',
      },
      ports: [
        {
          containerPort: 3000,
          hostPort: 3001,
          protocol: 'tcp',
        },
      ],
      environment: {
        NODE_ENV: 'development',
        PORT: '3000',
      },
      volumes: [],
    },
  });

  console.log('✅ Demo container created:', demoContainer.name);

  // Create system settings
  const defaultSettings = [
    {
      key: 'MAX_CONTAINERS_PER_MEMBER',
      value: '1',
    },
    {
      key: 'DEFAULT_CONTAINER_MEMORY',
      value: '512m',
    },
    {
      key: 'DEFAULT_CONTAINER_CPU',
      value: '0.5',
    },
    {
      key: 'ALLOWED_IMAGES',
      value: JSON.stringify([
        'node:18-alpine',
        'node:16-alpine',
        'python:3.11-alpine',
        'python:3.9-alpine',
        'nginx:alpine',
        'ubuntu:22.04',
      ]),
    },
    {
      key: 'MAX_FILE_UPLOAD_SIZE',
      value: '100MB',
    },
  ];

  for (const setting of defaultSettings) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: setting,
    });
  }

  console.log('✅ System settings created');

  // Create sample audit logs
  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: 'USER_LOGIN',
      resource: 'AUTH',
      details: {
        method: 'password',
        success: true,
      },
      ipAddress: '127.0.0.1',
      userAgent: 'Seeder Script',
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: member.id,
      action: 'CONTAINER_CREATE',
      resource: 'CONTAINER',
      details: {
        containerId: demoContainer.id,
        containerName: demoContainer.name,
        image: demoContainer.image,
      },
      ipAddress: '127.0.0.1',
      userAgent: 'Seeder Script',
    },
  });

  console.log('✅ Sample audit logs created');

  console.log('\n🎉 Database seeding completed successfully!');
  console.log('\n📋 Default accounts:');
  console.log('👤 Admin:');
  console.log('   Username: admin');
  console.log('   Password: admin123');
  console.log('   Email: admin@panel.local');
  console.log('\n👤 Member:');
  console.log('   Username: member');
  console.log('   Password: member123');
  console.log('   Email: member@panel.local');
  console.log('\n🐳 Demo container created for member user');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ Error during seeding:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
