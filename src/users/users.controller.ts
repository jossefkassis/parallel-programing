import { Body, Controller, Get, Post } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { DatabaseService } from '../db/database.service';
import { users, wallets } from '../db/schema';
import { ZodPipe } from '../validation/zod.pipe';

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  balance: z.coerce.number().nonnegative().default(1000),
});

@Controller('users')
export class UsersController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  list() {
    return this.database.db
      .select()
      .from(users)
      .leftJoin(wallets, eq(users.id, wallets.userId))
      .orderBy(asc(users.id));
  }

  @Post()
  async create(@Body(new ZodPipe(createUserSchema)) body: z.infer<typeof createUserSchema>) {
    return this.database.transaction(async (client) => {
      const insertedUser = await client.query('INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *', [body.name, body.email]);
      const user = insertedUser.rows[0];
      const insertedWallet = await client.query('INSERT INTO wallets (user_id, balance) VALUES ($1, $2) RETURNING *', [user.id, body.balance]);
      return { ...user, wallet: insertedWallet.rows[0] };
    });
  }
}
