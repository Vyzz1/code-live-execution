import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm/dist/typeorm.module';
import { databaseProviders } from 'src/modules/database/database.providers';
import { AppDataSource } from './data-source';

@Module({
  imports: [TypeOrmModule.forRoot(AppDataSource.options)],
  providers: [...databaseProviders],
  exports: [...databaseProviders],
})
export class DatabaseModule {}
